import {
  Component,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
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
  GitBranch,
  Search,
  ChevronDown,
  ChevronRight,
  Network,
  List,
  LayoutGrid,
  Activity,
} from "lucide-react";
import { commitsAPI } from "../api/client";
import type { Commit } from "../types/api";
import { useT } from "../i18n/useLang";
import { t } from "../i18n/translate";
import { LanguageToggle } from "../components/common/LanguageToggle";

type Kind =
  | "source_dataset"
  | "dataset"
  | "run"
  | "version"
  | "artifact"
  | "stage"
  | "model";
type CentralNode = {
  id: string;
  type: Kind;
  label: string;
  versioned?: boolean;
  data: Record<string, unknown>;
};
type CentralEdge = { id: string; source: string; target: string; kind: string };
type CentralPayload = { nodes: CentralNode[]; edges: CentralEdge[] };
type AppInfo = { frontend_url?: string; status?: string };
type FlowData = {
  kind: Kind;
  label: string;
  sub?: string;
  raw?: Commit;
  central?: CentralNode;
  runId?: string;
  graphId?: string;
  collapsed?: boolean;
  insightUrl?: string;
  sandgraphUrl?: string;
  accent?: string;
};
const EMPTY_COMMITS: Commit[] = [];
const EMPTY_PAYLOAD: CentralPayload = { nodes: [], edges: [] };

const META: Record<Kind, { title: string; cls: string; color: string }> = {
  source_dataset: {
    title: "Dataset source commun",
    cls: "border-amber-500 bg-amber-950/30 text-amber-200 shadow-[0_0_18px_rgba(245,158,11,.22)]",
    color: "#f59e0b",
  },
  dataset: {
    title: "Dataset / subset",
    cls: "border-amber-600/60 bg-amber-950/30 text-amber-200",
    color: "#f59e0b",
  },
  run: {
    title: "Run MLOps",
    cls: "border-sky-600/60 bg-sky-950/30 text-sky-200",
    color: "#38bdf8",
  },
  version: {
    title: "Version DVC",
    cls: "border-indigo-600/60 bg-indigo-950/30 text-indigo-200",
    color: "#818cf8",
  },
  artifact: {
    title: "Artefact",
    cls: "border-cyan-600/60 bg-cyan-950/30 text-cyan-200",
    color: "#22d3ee",
  },
  stage: {
    title: "Run MLflow",
    cls: "border-violet-600/60 bg-violet-950/30 text-violet-200",
    color: "#a78bfa",
  },
  model: {
    title: "Modèle",
    cls: "border-emerald-600/60 bg-emerald-950/30 text-emerald-200",
    color: "#34d399",
  },
};

function FlowNode({ data, selected }: NodeProps) {
  const t = useT();
  const d = data as FlowData,
    m = META[d.kind];
  if (!m) return null;
  const open = (e: React.MouseEvent, url?: string) => {
    e.stopPropagation();
    if (url) window.location.assign(url);
  };
  return (
    <div
      style={d.accent ? { borderColor: d.accent } : undefined}
      className={`w-[210px] rounded-xl border bg-gray-900 shadow-lg overflow-hidden ${m.cls} ${selected ? "ring-2 ring-white/30" : ""}`}
    >
      <Handle
        id="in-top"
        type="target"
        position={Position.Top}
        className="!bg-gray-500"
      />
      <Handle
        id="in-left"
        type="target"
        position={Position.Left}
        className="!bg-gray-500"
      />
      <Handle
        id="in-right"
        type="target"
        position={Position.Right}
        className="!bg-gray-500"
      />
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/10 text-[10px] uppercase">
        <span className="flex-1">{t(m.title)}</span>
        {d.kind === "run" && (
          <>
            <button
              className="nodrag p-0.5 rounded hover:bg-white/10"
              title="Insight"
              onClick={(e) => open(e, d.insightUrl)}
            >
              <Activity size={12} />
            </button>
            <button
              className="nodrag p-0.5 rounded hover:bg-white/10"
              title="Sandgraph"
              onClick={(e) => open(e, d.sandgraphUrl)}
            >
              <Network size={12} />
            </button>
            <button
              className="nodrag p-0.5 rounded hover:bg-white/10"
              title={d.collapsed ? t("Déplier") : t("Replier")}
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent("dvc:toggle-run", { detail: d.runId }),
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
          <p className="text-[10px] text-gray-500 font-mono truncate mt-0.5">
            {d.sub}
          </p>
        )}
      </div>
      <Handle
        id="out-bottom"
        type="source"
        position={Position.Bottom}
        className="!bg-gray-500"
      />
      <Handle
        id="out-left"
        type="source"
        position={Position.Left}
        className="!bg-gray-500"
      />
      <Handle
        id="out-right"
        type="source"
        position={Position.Right}
        className="!bg-gray-500"
      />
    </div>
  );
}
function GroupBox({ data }: NodeProps) {
  const d = data as { label?: string; fork?: boolean; total?: boolean };
  const cls = d.total
    ? "border-emerald-500/50 bg-emerald-950/5 text-emerald-300"
    : d.fork
      ? "border-rose-500/45 bg-rose-950/10 text-rose-300"
      : "border-sky-500/45 bg-sky-950/10 text-sky-300";
  return (
    <div
      className={`pointer-events-none h-full w-full rounded-2xl border-2 border-dashed p-3 text-xs font-semibold ${cls}`}
    >
      {d.label}
    </div>
  );
}
const nodeTypes = { lineage: FlowNode, groupbox: GroupBox };

class LineageErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  componentDidCatch(e: Error, i: ErrorInfo) {
    console.error("[DVC lineage]", e, i.componentStack);
  }
  render() {
    return this.state.error ? (
      <div className="h-full grid place-items-center bg-gray-950 text-center">
        <div>
          <p className="text-red-300 font-semibold">
            {t("Le lineage n’a pas pu être affiché.")}
          </p>
          <p className="mt-2 text-xs text-gray-500">{this.state.error}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded border border-gray-700 px-3 py-1.5 text-xs"
          >
            {t("Réessayer")}
          </button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}

const BW = 720,
  BG = 70,
  NG = 225;
function buildFlow(
  payload: CentralPayload,
  commits: Commit[],
  search: string,
  collapsed: Set<string>,
  orchUrl: string,
  t: (fr: string) => string,
) {
  const q = search.trim().toLowerCase(),
    byId = Object.fromEntries(payload.nodes.map((n) => [n.id, n]));
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
    commitByRun = new Map(
      commits
        .filter((c) => c.lineage?.run_id)
        .map((c) => [c.lineage!.run_id!, c]),
    );
  const source = payload.nodes.find((n) => n.type === "source_dataset"),
    totalW = Math.max(BW, runs.length * BW + Math.max(0, runs.length - 1) * BG);
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
        central: source,
      },
    });
  }
  let maxH = 700;
  runs.forEach((r, i) => {
    const x0 = i * (BW + BG),
      runId = String(r.data.run_id || ""),
      graphId = String(r.data.graph_id || ""),
      fork = Boolean(r.data.is_fork || r.data.parent_run_id),
      compactRun = collapsed.has(runId),
      commit = commitByRun.get(runId),
      runX = x0 + 245;
    visible.add(r.id);
    nodes.push({
      id: r.id,
      type: "lineage",
      position: { x: runX, y: 260 },
      data: {
        kind: "run",
        label: String(r.data.graph_name || r.label),
        sub: `${runId} · ${String(r.data.status || "")}`,
        central: r,
        runId,
        graphId,
        collapsed: compactRun,
        insightUrl: `${orchUrl}/mlops/insights?graph_id=${encodeURIComponent(graphId)}&run_id=${encodeURIComponent(runId)}`,
        sandgraphUrl: `${orchUrl}/?graph_id=${encodeURIComponent(graphId)}`,
      },
    });
    const subsets = payload.edges
      .filter((e) => e.source === r.id && e.kind === "subset")
      .map((e) => byId[e.target])
      .filter(Boolean);
    subsets.forEach((d, j) => {
      visible.add(d.id);
      nodes.push({
        id: d.id,
        type: "lineage",
        position: { x: runX + j * NG, y: 430 },
        data: {
          kind: "dataset",
          label: d.label,
          sub: `${String(d.data.dataset || "")} · ${String(d.data.dvc_version || t("non versionné"))}`,
          central: d,
        },
      });
    });
    const produced: FlowData[] = [];
    if (commit) {
      produced.push({
        kind: "version",
        label: commit.subject,
        sub: `commit ${commit.short}`,
        raw: commit,
        runId,
        graphId,
      });
      for (const f of commit.dvc_files.slice(0, 6))
        produced.push({
          kind: "artifact",
          label: f,
          sub: t("objet suivi par DVC"),
          raw: commit,
          runId,
          graphId,
        });
    }
    for (const p of payload.edges
      .filter(
        (e) => e.source === r.id && ["artifact", "model"].includes(e.kind),
      )
      .map((e) => byId[e.target])
      .filter(Boolean)) {
      if (p.versioned)
        produced.push({
          kind: p.type,
          label: p.label,
          sub: String(p.data.path || ""),
          central: p,
          runId,
          graphId,
        });
    }
    if (!compactRun)
      produced.forEach((d, j) =>
        nodes.push({
          id: `${r.id}:product:${j}`,
          type: "lineage",
          position: {
            x: x0 + 20 + (j % 3) * NG,
            y: 610 + Math.floor(j / 3) * 150,
          },
          data: d,
        }),
      );
    const h = compactRun
      ? 430
      : Math.max(
          650,
          710 + Math.floor(Math.max(0, produced.length - 1) / 3) * 150,
        );
    maxH = Math.max(maxH, h + 240);
    nodes.unshift({
      id: `frame:${r.id}`,
      type: "groupbox",
      position: { x: x0, y: 220 },
      data: { label: `${fork ? t("Run fork") : t("Run mère")}${t(" · vue DVC")}`, fork },
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
        "Expérience complète · source commune, versions Git/DVC et objets suivis",
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
        : "#22d3ee";
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
            ? t("subset extrait")
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
  for (const n of nodes.filter((n) => String(n.id).includes(":product:"))) {
    const sourceId = String(n.id).split(":product:")[0];
    edges.push({
      id: `edge:${n.id}`,
      source: sourceId,
      target: n.id,
      sourceHandle: "out-bottom",
      targetHandle: "in-top",
      type: "smoothstep",
      style: { stroke: META[(n.data as FlowData).kind].color },
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  }
  return { nodes, edges, runs };
}

function LineageInner() {
  const t = useT();
  const [params] = useSearchParams(),
    [search, setSearch] = useState(params.get("run_id") || ""),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [view, setView] = useState<"graph" | "list">("graph"),
    [selected, setSelected] = useState<FlowData | null>(null);
  const { data: commits = EMPTY_COMMITS } = useQuery({
    queryKey: ["commits", "lineage"],
    queryFn: () => commitsAPI.list(200),
  });
  const {
    data: payload = EMPTY_PAYLOAD,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["canonical-lineage"],
    queryFn: () =>
      axios
        .get<CentralPayload>("/orchestrator-api/lineage")
        .then((r) => r.data),
  });
  const { data: apps = {} } = useQuery({
    queryKey: ["orchestrator-apps"],
    queryFn: () =>
      axios
        .get<Record<string, AppInfo>>("/orchestrator-api/apps")
        .then((r) => r.data),
  });
  const orchPort = import.meta.env.VITE_ORCHESTRATOR_FRONTEND_PORT || "3000",
    orchUrl = `http://${location.hostname}:${orchPort}`;
  const mlflowUrl = (
    apps.mlflow?.frontend_url || `http://${location.hostname}:3001`
  ).replace("localhost", location.hostname);
  const flow = useMemo(
    () => buildFlow(payload, commits, search, collapsed, orchUrl, t),
    [payload, commits, search, collapsed, orchUrl, t],
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
    window.addEventListener("dvc:toggle-run", h);
    return () => window.removeEventListener("dvc:toggle-run", h);
  }, []);
  const runIds = flow.runs.map((r) => String(r.data.run_id || "")),
    allCompact = runIds.length > 0 && runIds.every((id) => collapsed.has(id));
  const onNodesChange = (c: NodeChange[]) =>
    setFlowNodes((ns) => applyNodeChanges(c, ns));
  return (
    <div className="h-full min-h-[600px] flex flex-col bg-gray-950">
      <header className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
        <GitBranch size={19} className="text-indigo-400" />
        <div>
          <h1 className="text-lg font-semibold text-white">{t("Lineage DVC")}</h1>
          <p className="text-[11px] text-gray-500">
            {t("Source commune → run → versions Git/DVC et objets suivis")}
          </p>
        </div>
        <div className="flex-1" />
        <a
          href={`${orchUrl}/mlops/lineage`}
          className="rounded-lg border border-emerald-500 bg-emerald-950/30 px-3 py-2 text-xs font-semibold text-emerald-300"
        >
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
          title="Auto"
          className="p-2 rounded border border-gray-700"
        >
          <LayoutGrid size={15} />
        </button>
        <button
          onClick={() => setCollapsed(allCompact ? new Set() : new Set(runIds))}
          className="flex items-center gap-1 p-2 rounded border border-gray-700 text-xs"
        >
          {allCompact ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{" "}
          {allCompact ? t("Décompact") : t("Compact")}
        </button>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-2.5 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Nom, Run ID, dataset…")}
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
                  <p className="text-xs font-semibold text-amber-300">
                    {t("Dataset source commun")}
                  </p>
                  <p className="mt-1 text-sm text-white">
                    {payload.nodes.find((n) => n.type === "source_dataset")
                      ?.label || t("Source inconnue")}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-gray-500">
                    {String(
                      payload.nodes.find((n) => n.type === "source_dataset")
                        ?.data.source_path || "",
                    )}
                  </p>
                </div>
                <div className="grid gap-5 xl:grid-cols-2">
                  {flow.runs.map((r) => {
                    const runId = String(r.data.run_id || ""),
                      commit = commits.find((c) => c.lineage?.run_id === runId);
                    return (
                      <section
                        key={r.id}
                        className={`rounded-2xl border-2 border-dashed p-4 ${r.data.is_fork ? "border-rose-700/50 bg-rose-950/10" : "border-sky-700/50 bg-sky-950/10"}`}
                      >
                        <div className="flex">
                          <div className="flex-1">
                            <p
                              className={
                                r.data.is_fork
                                  ? "text-xs text-rose-300"
                                  : "text-xs text-sky-300"
                              }
                            >
                              {r.data.is_fork ? t("Run fork") : t("Run mère")}
                            </p>
                            <h3 className="text-sm text-white">
                              {String(r.data.graph_name || r.label)}
                            </h3>
                            <p className="font-mono text-[10px] text-gray-500">
                              {runId} · {String(r.data.status || "")}
                            </p>
                          </div>
                          <span
                            className={`h-fit rounded px-2 py-1 text-[10px] ${commit ? "bg-emerald-950 text-emerald-300" : "bg-gray-900 text-gray-500"}`}
                          >
                            {commit ? t("versionné") : t("non versionné")}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg border border-amber-800/40 bg-amber-950/10 p-3">
                            <p className="text-[10px] text-amber-400">
                              {t("Subset utilisé")}
                            </p>
                            <p className="text-xs text-white">
                              {String(
                                r.data.subset_name || r.data.dataset || "—",
                              )}{" "}
                              · {String(r.data.subset_image_count || "?")}{" "}
                              images
                            </p>
                            <p className="font-mono text-[10px] text-gray-500">
                              DVC {String(r.data.dvc_version || t("non committé"))}
                            </p>
                          </div>
                          <div className="rounded-lg border border-indigo-800/40 bg-indigo-950/10 p-3">
                            <p className="text-[10px] text-indigo-400">
                              {t("Commit Git/DVC")}
                            </p>
                            <p className="text-xs text-white">
                              {commit?.subject || t("Aucun commit produit")}
                            </p>
                            <p className="font-mono text-[10px] text-gray-500">
                              {commit?.short || "—"}
                            </p>
                          </div>
                        </div>
                        <p className="mb-2 mt-4 text-[10px] uppercase text-gray-500">
                          {t("Objets suivis")}
                        </p>
                        <div className="space-y-1">
                          {commit?.dvc_files.map((file) => (
                            <div
                              key={file}
                              className="rounded border border-gray-800 bg-gray-900 px-3 py-2 font-mono text-[10px] text-cyan-200"
                            >
                              {file}
                            </div>
                          )) || (
                            <p className="rounded border border-dashed border-gray-800 p-3 text-xs text-gray-500">
                              {t("Aucun objet DVC pour ce run.")}
                            </p>
                          )}
                        </div>
                      </section>
                    );
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
            <h2 className="text-sm font-semibold text-white break-words">
              {selected.label}
            </h2>
            {selected.runId && (
              <div className="rounded-lg border border-violet-700/30 p-2">
                <p className="text-[10px] text-violet-400">{t("Run ID MLOps")}</p>
                <p className="font-mono text-violet-200">{selected.runId}</p>
              </div>
            )}
            {selected.runId && (
              <div className="grid grid-cols-3 gap-2">
                <a
                  href={`${mlflowUrl}/lineage?run_id=${selected.runId}`}
                  className="rounded border border-violet-700 p-2 text-center text-xs text-violet-300"
                >
                  MLflow
                </a>
                <a
                  href={
                    selected.insightUrl ||
                    `${orchUrl}/mlops/insights?graph_id=${selected.graphId || ""}&run_id=${selected.runId}`
                  }
                  className="rounded border border-cyan-700 p-2 text-center text-xs text-cyan-300"
                >
                  Insight
                </a>
                <a
                  href={
                    selected.sandgraphUrl ||
                    `${orchUrl}/?graph_id=${selected.graphId || ""}`
                  }
                  className="rounded border border-sky-700 p-2 text-center text-xs text-sky-300"
                >
                  Sandgraph
                </a>
              </div>
            )}
            {selected.raw && (
              <div className="flex gap-2">
                <Link
                  to={`/history?run_id=${selected.runId || ""}`}
                  className="text-xs text-indigo-300"
                >
                  {t("Historique")}
                </Link>
                <Link
                  to={`/diff?rev_a=${selected.raw.hash}~1&rev_b=${selected.raw.hash}`}
                  className="text-xs text-cyan-300"
                >
                  Diff
                </Link>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
export default function LineagePage() {
  return (
    <LineageErrorBoundary>
      <ReactFlowProvider>
        <LineageInner />
      </ReactFlowProvider>
    </LineageErrorBoundary>
  );
}
