import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  applyNodeChanges,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Workflow,
  Activity,
  Search,
  ChevronDown,
  ChevronRight,
  Network,
  List,
  LayoutGrid,
} from "lucide-react";
import { experimentsAPI, runsAPI } from "../api/client";
import type { RunSummary } from "../types/api";
import { LanguageToggle } from "../components/common/LanguageToggle";
import { useT } from "../i18n/useLang";

type Kind =
  | "source_dataset"
  | "dataset"
  | "run"
  | "stage"
  | "artifact"
  | "model";
type CNode = {
  id: string;
  type: Kind;
  label: string;
  data: Record<string, unknown>;
};
type CEdge = { id: string; source: string; target: string; kind: string };
type Payload = { nodes: CNode[]; edges: CEdge[] };
type AppInfo = { frontend_url?: string; status?: string };
type FlowData = {
  kind: Kind;
  label: string;
  sub?: string;
  node?: CNode;
  runId?: string;
  graphId?: string;
  collapsed?: boolean;
  insightUrl?: string;
  sandgraphUrl?: string;
  stage?: RunSummary;
};
const EMPTY_RUNS: RunSummary[] = [];
const EMPTY_PAYLOAD: Payload = { nodes: [], edges: [] };
const META: Record<Kind, { title: string; cls: string; color: string }> = {
  source_dataset: {
    title: "Dataset source commun",
    cls: "border-amber-500 text-amber-200 shadow-[0_0_18px_rgba(245,158,11,.22)]",
    color: "#f59e0b",
  },
  dataset: {
    title: "Subset utilisé",
    cls: "border-amber-600/60 text-amber-200",
    color: "#f59e0b",
  },
  run: {
    title: "Run pipeline unifié",
    cls: "border-sky-600/60 text-sky-200",
    color: "#38bdf8",
  },
  stage: {
    title: "Étape MLflow",
    cls: "border-violet-600/60 text-violet-200",
    color: "#a78bfa",
  },
  artifact: {
    title: "Artefact",
    cls: "border-cyan-600/60 text-cyan-200",
    color: "#22d3ee",
  },
  model: {
    title: "Modèle",
    cls: "border-emerald-600/60 text-emerald-200",
    color: "#34d399",
  },
};

function FlowNode({ data, selected }: NodeProps) {
  const t = useT();
  const d = data as FlowData,
    m = META[d.kind];
  if (!m) return null;
  const open = (e: React.MouseEvent, u?: string) => {
    e.stopPropagation();
    if (u) window.location.assign(u);
  };
  return (
    <div
      className={`w-[210px] rounded-xl border bg-gray-900 shadow-lg overflow-hidden ${m.cls} ${selected ? "ring-2 ring-white/30" : ""}`}
    >
      <Handle id="in-top" type="target" position={Position.Top} />
      <Handle id="in-left" type="target" position={Position.Left} />
      <Handle id="in-right" type="target" position={Position.Right} />
      <div className="px-3 py-1.5 border-b border-white/10 text-[10px] uppercase flex items-center gap-1">
        <span className="flex-1">{t(m.title)}</span>
        {d.kind === "run" && (
          <>
            <button
              className="nodrag p-0.5"
              title="Insight"
              onClick={(e) => open(e, d.insightUrl)}
            >
              <Activity size={12} />
            </button>
            <button
              className="nodrag p-0.5"
              title="Sandgraph"
              onClick={(e) => open(e, d.sandgraphUrl)}
            >
              <Network size={12} />
            </button>
            <button
              className="nodrag p-0.5"
              title={d.collapsed ? t("Déplier") : t("Replier")}
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent("mlflow:toggle-run", { detail: d.runId }),
                );
              }}
            >
              {d.collapsed ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </button>
          </>
        )}
      </div>
      <div className="px-3 py-2">
        <p
          className="text-xs font-semibold text-white truncate"
          title={d.label}
        >
          {d.label}
        </p>
        {d.sub && (
          <p className="text-[10px] text-gray-500 font-mono truncate">
            {d.sub}
          </p>
        )}
      </div>
      <Handle id="out-bottom" type="source" position={Position.Bottom} />
      <Handle id="out-left" type="source" position={Position.Left} />
      <Handle id="out-right" type="source" position={Position.Right} />
    </div>
  );
}
function GroupBox({ data }: NodeProps) {
  const d = data as { label?: string; fork?: boolean; total?: boolean };
  const c = d.total
    ? "border-emerald-500/50 bg-emerald-950/5 text-emerald-300"
    : d.fork
      ? "border-rose-500/45 bg-rose-950/10 text-rose-300"
      : "border-sky-500/45 bg-sky-950/10 text-sky-300";
  return (
    <div
      className={`pointer-events-none h-full w-full rounded-2xl border-2 border-dashed p-3 text-xs font-semibold ${c}`}
    >
      {d.label}
    </div>
  );
}
const nodeTypes = { lineage: FlowNode, groupbox: GroupBox },
  BW = 720,
  BG = 70,
  NG = 225;

function build(
  payload: Payload,
  localRuns: RunSummary[],
  search: string,
  collapsed: Set<string>,
  orchUrl: string,
  t: (fr: string) => string,
) {
  const q = search.trim().toLowerCase(),
    byId = Object.fromEntries(payload.nodes.map((n) => [n.id, n])),
    stageById = new Map(localRuns.map((s) => [s.run_id, s]));
  const runs = payload.nodes
    .filter(
      (n) =>
        n.type === "run" &&
        (!q ||
          [
            n.label,
            n.data.graph_name,
            n.data.run_id,
            n.data.dataset,
            n.data.subset_name,
          ].some((v) =>
            String(v || "")
              .toLowerCase()
              .includes(q),
          )),
    )
    .sort(
      (a, b) =>
        Number(Boolean(a.data.is_fork)) - Number(Boolean(b.data.is_fork)),
    );
  const nodes: Node[] = [],
    edges: Edge[] = [],
    visible = new Set<string>(),
    totalW = Math.max(BW, runs.length * BW + Math.max(0, runs.length - 1) * BG),
    source = payload.nodes.find((n) => n.type === "source_dataset");
  if (source) {
    visible.add(source.id);
    nodes.push({
      id: source.id,
      type: "lineage",
      position: { x: totalW / 2 - 105, y: 55 },
      data: {
        kind: "source_dataset",
        label: source.label,
        sub: String(source.data.source_path || ""),
        node: source,
      },
    });
  }
  let maxH = 700;
  runs.forEach((r, i) => {
    const x0 = i * (BW + BG),
      rid = String(r.data.run_id || ""),
      gid = String(r.data.graph_id || ""),
      fork = Boolean(r.data.is_fork || r.data.parent_run_id),
      compactRun = collapsed.has(rid),
      runX = x0 + 245;
    visible.add(r.id);
    nodes.push({
      id: r.id,
      type: "lineage",
      position: { x: runX, y: 260 },
      data: {
        kind: "run",
        label: String(r.data.graph_name || r.label),
        sub: `orch_run_id · ${rid} · ${String(r.data.status || "")}`,
        node: r,
        runId: rid,
        graphId: gid,
        collapsed: compactRun,
        insightUrl: `${orchUrl}/mlops/insights?graph_id=${gid}&run_id=${rid}`,
        sandgraphUrl: `${orchUrl}/?graph_id=${gid}`,
      },
    });
    payload.edges
      .filter((e) => e.source === r.id && e.kind === "subset")
      .map((e) => byId[e.target])
      .filter(Boolean)
      .forEach((d, j) => {
        visible.add(d.id);
        nodes.push({
          id: d.id,
          type: "lineage",
          position: { x: runX + j * NG, y: 430 },
          data: {
            kind: "dataset",
            label: d.label,
            sub: String(d.data.dataset || ""),
            node: d,
            runId: rid,
            graphId: gid,
          },
        });
      });
    const stages = payload.edges
      .filter((e) => e.source === r.id && e.kind === "mlflow")
      .map((e) => byId[e.target])
      .filter(Boolean);
    if (!compactRun)
      stages.forEach((p, j) => {
        visible.add(p.id);
        nodes.push({
          id: p.id,
          type: "lineage",
          position: { x: x0 + 125 + j * NG, y: 610 },
          data: {
            kind: "stage",
            label: p.label,
            sub: String(p.data.mlflow_run_id || ""),
            node: p,
            runId: rid,
            graphId: gid,
            stage: stageById.get(String(p.data.mlflow_run_id || "")),
          },
        });
      });
    const h = compactRun
      ? 430
      : Math.max(
          650,
          700 + Math.floor(Math.max(0, stages.length - 1) / 3) * 150,
        );
    maxH = Math.max(maxH, h + 240);
    nodes.unshift({
      id: `frame:${r.id}`,
      type: "groupbox",
      position: { x: x0, y: 220 },
      data: { label: `${fork ? t("Run fork") : t("Run mère")}${t(" · vue MLflow")}`, fork },
      style: { width: BW, height: h, zIndex: -20, pointerEvents: "none" },
      draggable: false,
      selectable: false,
      focusable: false,
    });
  });
  nodes.unshift({
    id: "frame:all",
    type: "groupbox",
    position: { x: -30, y: 10 },
    data: {
      label: t(
        "Expérience complète · source commune, runs pipeline et étapes MLflow",
      ),
      total: true,
    },
    style: {
      width: totalW + 60,
      height: maxH,
      zIndex: -30,
      pointerEvents: "none",
    },
    draggable: false,
    selectable: false,
    focusable: false,
  });
  for (const e of payload.edges) {
    if (!visible.has(e.source) || !visible.has(e.target)) continue;
    const color = ["source", "subset"].includes(e.kind)
      ? "#f59e0b"
      : e.kind === "fork"
        ? "#818cf8"
        : "#a78bfa";
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.kind === "fork" ? "out-right" : "out-bottom",
      targetHandle: e.kind === "fork" ? "in-left" : "in-top",
      type: "smoothstep",
      animated: e.kind === "fork",
      label:
        e.kind === "fork"
          ? "fork"
          : e.kind === "subset"
            ? "subset utilisé"
            : undefined,
      style: {
        stroke: color,
        strokeDasharray: ["source", "subset", "fork"].includes(e.kind)
          ? "6 5"
          : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    });
  }
  return { nodes, edges, runs };
}

function Inner() {
  const t = useT();
  const [params] = useSearchParams(),
    [search, setSearch] = useState(params.get("run_id") || ""),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [view, setView] = useState<"graph" | "list">("graph"),
    [selected, setSelected] = useState<FlowData | null>(null);
  const { data: local = EMPTY_RUNS } = useQuery({
    queryKey: ["mlflow-lineage-local"],
    queryFn: async () => {
      const exps = await experimentsAPI.list();
      return (
        await Promise.all(exps.map((e) => runsAPI.list(e.experiment_id, 1000)))
      ).flat();
    },
  });
  const {
    data: payload = EMPTY_PAYLOAD,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["canonical-lineage"],
    queryFn: () =>
      axios.get<Payload>("/orchestrator-api/lineage").then((r) => r.data),
  });
  const { data: apps = {} } = useQuery({
    queryKey: ["orchestrator-apps"],
    queryFn: () =>
      axios
        .get<Record<string, AppInfo>>("/orchestrator-api/apps")
        .then((r) => r.data),
  });
  const orchPort = import.meta.env.VITE_ORCHESTRATOR_FRONTEND_PORT || "3000",
    orchUrl = `http://${location.hostname}:${orchPort}`,
    dvcUrl = (
      apps.dvc?.frontend_url || `http://${location.hostname}:3002`
    ).replace("localhost", location.hostname);
  const flow = useMemo(
    () => build(payload, local, search, collapsed, orchUrl, t),
    [payload, local, search, collapsed, orchUrl, t],
  );
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  useEffect(() => setFlowNodes(flow.nodes), [flow.nodes]);
  useEffect(() => {
    const h = (e: Event) =>
      setCollapsed((s) => {
        const n = new Set(s),
          id = String((e as CustomEvent<string>).detail || "");
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      });
    window.addEventListener("mlflow:toggle-run", h);
    return () => window.removeEventListener("mlflow:toggle-run", h);
  }, []);
  const ids = flow.runs.map((r) => String(r.data.run_id || "")),
    all = ids.length > 0 && ids.every((id) => collapsed.has(id));
  const onNodesChange = (c: NodeChange[]) =>
    setFlowNodes((ns) => applyNodeChanges(c, ns));
  return (
    <div className="h-full min-h-[600px] flex flex-col bg-gray-950">
      <header className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
        <Workflow size={19} className="text-violet-400" />
        <div>
          <h1 className="text-lg font-semibold text-white">{t("Lineage MLflow")}</h1>
          <p className="text-[11px] text-gray-500">
            {t("Source commune → run pipeline → étapes, métriques et artefacts MLflow")}
          </p>
        </div>
        <div className="flex-1" />
        <a href={`${orchUrl}/mlops/lineage`} className="rounded-lg border border-emerald-500 bg-emerald-950/30 px-3 py-2 text-xs font-semibold text-emerald-300">
          {t("Comparer les runs")}
        </a>
        <button
          onClick={() => setView(view === "graph" ? "list" : "graph")}
          aria-label={view === "graph" ? t("Afficher la liste") : t("Afficher le graphe")}
          title={view === "graph" ? t("Afficher la liste") : t("Afficher le graphe")}
          className="p-2 rounded border border-gray-700"
        >
          {view === "graph" ? <List size={15} /> : <Network size={15} />}
        </button>
        <button
          onClick={() => setFlowNodes(flow.nodes)}
          className="p-2 rounded border border-gray-700"
          title="Auto"
        >
          <LayoutGrid size={15} />
        </button>
        <button
          onClick={() => setCollapsed(all ? new Set() : new Set(ids))}
          className="flex items-center gap-1 p-2 rounded border border-gray-700 text-xs"
        >
          {all ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{" "}
          {all ? t("Décompact") : t("Compact")}
        </button>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-2.5 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Expérience, Run ID, dataset…")}
            className="w-64 bg-gray-900 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-xs text-white"
          />
        </div>
        <LanguageToggle />
      </header>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1">
          {isLoading ? (
            <div className="h-full grid place-items-center text-gray-500">
              {t("Chargement…")}
            </div>
          ) : error ? (
            <div className="h-full grid place-items-center text-red-300">
              {t("Orchestrator indisponible : lineage canonique inaccessible.")}
            </div>
          ) : view === "graph" ? (
            <ReactFlow
              nodes={flowNodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              fitView
              onNodesChange={onNodesChange}
              onNodeClick={(_, n) => {
                const d = n.data as Partial<FlowData>;
                if (d.kind && META[d.kind]) setSelected(d as FlowData);
              }}
              onPaneClick={() => setSelected(null)}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} color="#1f2937" />
              <Controls />
              <MiniMap
                nodeColor={(n) =>
                  META[(n.data as Partial<FlowData>).kind as Kind]?.color ||
                  "#334155"
                }
                maskColor="rgba(3,7,18,.75)"
              />
            </ReactFlow>
          ) : (
            <div className="h-full overflow-auto p-6">
              <div className="mx-auto max-w-[1450px] rounded-2xl border border-emerald-700/40 bg-emerald-950/5 p-5">
                <div className="mb-5 rounded-xl border border-amber-700/50 bg-amber-950/15 p-4">
                  <p className="text-xs font-semibold text-amber-300">{t("Dataset source commun")}</p>
                  <p className="mt-1 text-sm text-white">{payload.nodes.find(n => n.type === "source_dataset")?.label || t("Source inconnue")}</p>
                  <p className="mt-1 font-mono text-[10px] text-gray-500">{String(payload.nodes.find(n => n.type === "source_dataset")?.data.source_path || "")}</p>
                </div>
                <div className="grid gap-5 xl:grid-cols-2">
                  {flow.runs.map(r => {
                    const rid = String(r.data.run_id || "")
                    const stages = payload.edges.filter(e => e.source === r.id && e.kind === "mlflow").map(e => payload.nodes.find(n => n.id === e.target)).filter(Boolean) as CNode[]
                    return <section key={r.id} className={`rounded-2xl border-2 border-dashed p-4 ${r.data.is_fork ? "border-rose-700/50 bg-rose-950/10" : "border-sky-700/50 bg-sky-950/10"}`}>
                      <div className="flex"><div className="flex-1"><p className={r.data.is_fork ? "text-xs text-rose-300" : "text-xs text-sky-300"}>{r.data.is_fork ? t("Run fork") : t("Run mère")}</p><h3 className="text-sm text-white">{String(r.data.graph_name || r.label)}</h3><p className="font-mono text-[10px] text-violet-300">orch_run_id={rid}</p></div><span className="h-fit rounded bg-violet-950 px-2 py-1 text-[10px] text-violet-300">{stages.length} {t("étape(s)")}</span></div>
                      <div className="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/10 p-3"><p className="text-[10px] text-amber-400">{t("Subset utilisé")}</p><p className="text-xs text-white">{String(r.data.subset_name || r.data.dataset || "—")} · {String(r.data.subset_image_count || "?")} images</p></div>
                      <p className="mb-2 mt-4 text-[10px] uppercase text-gray-500">{t("Étapes MLflow et métriques")}</p>
                      <div className="space-y-2">{stages.map(stage => { const metrics = (stage.data.metrics || {}) as Record<string, unknown>; return <button key={stage.id} onClick={() => { const localStage = local.find(x => x.run_id === stage.data.mlflow_run_id); setSelected({ kind: "stage", label: stage.label, sub: String(stage.data.mlflow_run_id || ""), node: stage, runId: rid, graphId: String(r.data.graph_id || ""), stage: localStage }) }} className="w-full rounded-lg border border-violet-800/40 bg-violet-950/10 p-3 text-left"><p className="text-xs text-violet-200">{stage.label}</p><p className="mt-1 font-mono text-[10px] text-gray-500">{Object.entries(metrics).slice(0, 4).map(([k,v]) => `${k}=${typeof v === "number" ? v.toFixed(4) : v}`).join(" · ") || t("Aucune métrique")}</p></button>})}{!stages.length && <p className="rounded border border-dashed border-gray-800 p-3 text-xs text-gray-500">{t("Aucune étape MLflow : le fork s’est interrompu avant Training.")}</p>}</div>
                    </section>
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
        {selected && (
          <aside className="w-80 border-l border-gray-800 bg-gray-900 p-4 space-y-3 overflow-y-auto">
            <p className="text-[10px] uppercase text-gray-500">
              {t(META[selected.kind].title)}
            </p>
            <h2 className="text-sm font-semibold text-white">
              {selected.label}
            </h2>
            {selected.runId && (
              <>
                <div className="rounded border border-violet-700/30 p-2">
                  <p className="text-[10px] text-violet-400">
                    {t("Run ID MLOps · orch_run_id")}
                  </p>
                  <p className="font-mono text-violet-200">{selected.runId}</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <a
                    href={`${dvcUrl}/lineage?run_id=${selected.runId}`}
                    className="rounded border border-indigo-700 p-2 text-center text-xs text-indigo-300"
                  >
                    DVC
                  </a>
                  <a
                    href={`${orchUrl}/mlops/insights?graph_id=${selected.graphId || ""}&run_id=${selected.runId}`}
                    className="rounded border border-cyan-700 p-2 text-center text-xs text-cyan-300"
                  >
                    Insight
                  </a>
                  <a
                    href={`${orchUrl}/?graph_id=${selected.graphId || ""}`}
                    className="rounded border border-sky-700 p-2 text-center text-xs text-sky-300"
                  >
                    Sandgraph
                  </a>
                </div>
              </>
            )}
            {selected.stage && (
              <Link
                to={`/runs/${selected.stage.run_id}`}
                className="block rounded border border-violet-700/40 p-2 text-xs text-violet-300"
              >
                {t("Ouvrir le run MLflow détaillé")}
              </Link>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
export default function LineagePage() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  );
}
