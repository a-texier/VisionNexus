import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import axios from "axios";
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  FlaskConical,
  GitCompareArrows,
  GitFork,
  GripVertical,
  LayoutGrid,
  List,
  Loader2,
  Network,
  Search,
  X,
} from "lucide-react";

type NodeKind =
  "source_dataset" | "dataset" | "run" | "model" | "stage" | "artifact";
type EdgeKind = "source" | "subset" | "model" | "fork" | "mlflow" | "artifact";
type Snapshot = Record<string, unknown>;
interface LineageNodeData {
  graph_id?: string;
  graph_name?: string;
  run_id?: string;
  status?: string | null;
  git_commit?: string | null;
  dataset?: string | null;
  dvc_version?: string | null;
  model_path?: string | null;
  map50?: number | null;
  mlflow_run_ids?: string[];
  mlflow_run_id?: string;
  run_type?: string;
  artifact_kind?: string;
  path?: string;
  state?: string;
  draft?: boolean;
  versioned?: boolean;
  is_fork?: boolean;
  parent_run_id?: string | null;
  source_dataset?: string;
  source_path?: string;
  source_image_count?: number;
  subset_name?: string;
  subset_image_count?: number;
  comparison?: Snapshot;
  [key: string]: unknown;
}
interface LineageNode {
  id: string;
  type: NodeKind;
  label: string;
  versioned?: boolean;
  data: LineageNodeData;
}
interface LineageEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
}
interface LineagePayload {
  nodes: LineageNode[];
  edges: LineageEdge[];
}
interface DiffRow {
  key: string;
  label: string;
  state: "identical" | "modified" | "added" | "removed";
  left: unknown;
  right: unknown;
}
interface FieldDiff {
  path: string;
  left: unknown;
  right: unknown;
}

const SECTION_LABELS: Record<string, string> = {
  dataset_source: "Dataset source",
  subset: "Subset utilisé",
  annotations_yolo: "Annotations YOLO",
  annotations_ver: "Annotations .ver",
  hpo: "Paramètres HPO",
  training: "Paramètres de training",
  model: "Modèle",
  mlflow: "Étapes MLflow",
  artifacts: "Artefacts",
  metrics: "Métriques",
};
const short = (value?: string | null, n = 8) =>
  value ? String(value).slice(0, n) : "";
const compact = (value: unknown): string => {
  if (value == null) return "—";
  if (Array.isArray(value))
    return value.length
      ? value
          .map((v) => (typeof v === "object" ? compact(v) : String(v)))
          .join(", ")
      : "—";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length),
    );
    return entries.length
      ? entries
          .slice(0, 5)
          .map(
            ([k, v]) =>
              `${k}: ${typeof v === "object" ? compact(v) : String(v)}`,
          )
          .join(" · ")
      : "—";
  }
  return String(value);
};
const normalized = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map(normalized).sort().join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${normalized(v)}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
};
const flatten = (
  value: unknown,
  prefix = "",
  result: Record<string, unknown> = {},
): Record<string, unknown> => {
  if (Array.isArray(value)) {
    if (!value.length) result[prefix || "valeur"] = [];
    else
      value.forEach((item, index) =>
        flatten(item, `${prefix}[${index}]`, result),
      );
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) result[prefix || "valeur"] = {};
    else
      entries.forEach(([key, item]) =>
        flatten(item, prefix ? `${prefix}.${key}` : key, result),
      );
  } else result[prefix || "valeur"] = value;
  return result;
};
const fieldDiffs = (row: DiffRow): FieldDiff[] => {
  const left = flatten(row.left),
    right = flatten(row.right),
    keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys]
    .filter((key) => normalized(left[key]) !== normalized(right[key]))
    .map((path) => ({ path, left: left[path], right: right[path] }));
};
function compareRuns(left?: LineageNode, right?: LineageNode): DiffRow[] {
  if (!left || !right) return [];
  const a = left.data.comparison ?? {},
    b = right.data.comparison ?? {};
  return Object.keys(SECTION_LABELS).map((key) => {
    const av = a[key],
      bv = b[key],
      aEmpty = av == null || normalized(av) === normalized({}),
      bEmpty = bv == null || normalized(bv) === normalized({});
    const state: DiffRow["state"] =
      normalized(av) === normalized(bv)
        ? "identical"
        : aEmpty
          ? "added"
          : bEmpty
            ? "removed"
            : "modified";
    return { key, label: SECTION_LABELS[key], state, left: av, right: bv };
  });
}

const META: Record<
  NodeKind,
  { title: string; color: string; icon: React.ReactNode }
> = {
  source_dataset: {
    title: "Dataset source commun",
    color: "#f59e0b",
    icon: <Database size={14} />,
  },
  dataset: {
    title: "Subset extrait",
    color: "#f59e0b",
    icon: <Database size={14} />,
  },
  run: { title: "Run", color: "#818cf8", icon: <FlaskConical size={14} /> },
  model: { title: "Modèle", color: "#34d399", icon: <Boxes size={14} /> },
  stage: {
    title: "Étape MLflow",
    color: "#a78bfa",
    icon: <Activity size={14} />,
  },
  artifact: {
    title: "Artefact",
    color: "#22d3ee",
    icon: <FileText size={14} />,
  },
};

function FlowCard({ data, selected }: NodeProps) {
  const d = data as {
    kind: NodeKind;
    label: string;
    sub?: string;
    changed?: boolean;
    added?: boolean;
    removed?: boolean;
    versioned?: boolean;
    collapsed?: boolean;
    nodeId: string;
    graphId?: string;
    runId?: string;
  };
  const meta = META[d.kind];
  const isSource = d.kind === "source_dataset";
  const open = (event: React.MouseEvent, href: string) => {
    event.stopPropagation();
    window.location.assign(href);
  };
  const accent = d.added
    ? "#22c55e"
    : d.removed
      ? "#eab308"
      : d.changed
        ? "#ef4444"
        : meta.color;
  return (
    <div
      className={`w-[230px] overflow-hidden rounded-xl border bg-gray-900 shadow-xl ${selected ? "ring-2 ring-white/30" : ""}`}
      style={{
        borderColor: accent,
        boxShadow:
          d.changed || d.added || d.removed || isSource
            ? `0 0 20px ${accent}30`
            : undefined,
      }}
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
      <div
        className="flex items-center gap-2 border-b px-3 py-2 text-[11px] font-semibold"
        style={{
          color: accent,
          borderColor: `${accent}55`,
          background: `${accent}12`,
        }}
      >
        {meta.icon}
        <span className="flex-1 truncate">{meta.title}</span>
        {d.changed && (
          <span className="rounded border border-red-500/60 px-1 text-[9px] text-red-300">
            modifié
          </span>
        )}
        {d.added && (
          <span className="rounded border border-green-500/60 px-1 text-[9px] text-green-300">
            ajouté
          </span>
        )}
        {d.removed && (
          <span className="rounded border border-yellow-500/60 px-1 text-[9px] text-yellow-300">
            supprimé
          </span>
        )}
        {d.kind === "run" && d.runId && (
          <>
            <button
              className="nodrag rounded p-0.5 hover:bg-white/10"
              title="Insight"
              onClick={(e) =>
                open(
                  e,
                  `/mlops/insights?graph_id=${encodeURIComponent(d.graphId || "")}&run_id=${encodeURIComponent(d.runId || "")}`,
                )
              }
            >
              <Activity size={12} />
            </button>
            <button
              className="nodrag rounded p-0.5 hover:bg-white/10"
              title="Sandgraph"
              onClick={(e) =>
                open(e, `/?graph_id=${encodeURIComponent(d.graphId || "")}`)
              }
            >
              <Network size={12} />
            </button>
            <button
              className="nodrag rounded p-0.5 hover:bg-white/10"
              title={
                d.collapsed
                  ? "Déplier les productions"
                  : "Replier les productions"
              }
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent("lineage:toggle-run", { detail: d.nodeId }),
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
        {isSource && (
          <button
            className="nodrag rounded p-0.5 hover:bg-white/10"
            title={
              d.collapsed ? "Déplier l’expérience" : "Replier l’expérience"
            }
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new Event("lineage:toggle-source"));
            }}
          >
            {d.collapsed ? (
              <ChevronRight size={13} />
            ) : (
              <ChevronDown size={13} />
            )}
          </button>
        )}
      </div>
      <div className="px-3 py-2">
        <p className="truncate text-xs font-medium text-white" title={d.label}>
          {d.label}
        </p>
        {d.sub && (
          <p
            className="mt-1 truncate font-mono text-[10px] text-gray-500"
            title={d.sub}
          >
            {d.sub}
          </p>
        )}
      </div>
      <Handle
        id="out-right"
        type="source"
        position={Position.Right}
        className="!bg-gray-500"
      />
      <Handle
        id="out-left"
        type="source"
        position={Position.Left}
        className="!bg-gray-500"
      />
      <Handle
        id="out-bottom"
        type="source"
        position={Position.Bottom}
        className="!bg-gray-500"
      />
    </div>
  );
}

function GroupBox({ data }: NodeProps) {
  const d = data as { label: string; fork?: boolean; total?: boolean };
  const cls = d.total
    ? "border-emerald-500/60 bg-emerald-950/5 text-emerald-300"
    : d.fork
      ? "border-rose-500/50 bg-rose-950/10 text-rose-300"
      : "border-sky-500/50 bg-sky-950/10 text-sky-300";
  return (
    <div
      className={`pointer-events-none h-full w-full rounded-2xl border-2 border-dashed p-3 text-xs font-semibold ${cls}`}
    >
      {d.label}
    </div>
  );
}

let activeRunToken: string | null = null;

function RunToken({ data }: NodeProps) {
  const d = data as { runId: string; label: string; fork: boolean };
  return (
    <div
      draggable
      data-run-token={d.runId}
      onMouseDown={(event) => {
        activeRunToken = d.runId;
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        activeRunToken = d.runId;
        event.stopPropagation();
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-lineage-run", d.runId);
        event.dataTransfer.effectAllowed = "copy";
      }}
      className={`nodrag flex w-[185px] cursor-grab items-center gap-2 rounded-lg border px-2.5 py-2 text-[10px] shadow-lg active:cursor-grabbing ${d.fork ? "border-rose-500/60 bg-rose-950/80 text-rose-200" : "border-sky-500/60 bg-sky-950/80 text-sky-200"}`}
    >
      <span className="font-mono">ID-{short(d.runId)}</span>
      <span className="flex-1 truncate">{d.label}</span>
      <GripVertical size={13} />
    </div>
  );
}
const nodeTypes = { lineage: FlowCard, groupbox: GroupBox, token: RunToken };

const BW = 720,
  GAP = 70,
  NODE_GAP = 235;
function buildFlow(
  payload: LineagePayload,
  collapsed: Set<string>,
  sourceCollapsed: boolean,
  diffs: DiffRow[],
  compared: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const runs = payload.nodes
    .filter((n) => n.type === "run")
    .sort(
      (a, b) =>
        Number(Boolean(a.data.is_fork)) - Number(Boolean(b.data.is_fork)),
    );
  const source = payload.nodes.find((n) => n.type === "source_dataset");
  const changed = new Set(
    diffs.filter((d) => d.state !== "identical").map((d) => d.key),
  );
  const positions: Record<string, { x: number; y: number }> = {},
    owner: Record<string, string> = {};
  const nodes: Node[] = [];
  const totalW = Math.max(
    BW,
    runs.length * BW + Math.max(0, runs.length - 1) * GAP,
  );
  if (source) positions[source.id] = { x: totalW / 2 - 115, y: 55 };
  if (!sourceCollapsed)
    runs.forEach((run, index) => {
      const x0 = index * (BW + GAP),
        runX = x0 + 245;
      positions[run.id] = { x: runX, y: 260 };
      owner[run.id] = run.id;
      payload.edges
        .filter((e) => e.source === run.id && e.kind === "subset")
        .map((e) => e.target)
        .forEach((id, i) => {
          positions[id] = { x: runX + i * NODE_GAP, y: 430 };
          owner[id] = run.id;
        });
      const outputs = payload.edges
        .filter(
          (e) =>
            e.source === run.id &&
            ["model", "mlflow", "artifact"].includes(e.kind),
        )
        .map((e) => e.target);
      if (!collapsed.has(run.id))
        outputs.forEach((id, i) => {
          positions[id] = {
            x: x0 + 10 + (i % 3) * NODE_GAP,
            y: 610 + Math.floor(i / 3) * 155,
          };
          owner[id] = run.id;
        });
      nodes.push({
        id: `token:${run.id}`,
        type: "token",
        position: { x: runX + 245, y: 275 },
        data: {
          runId: String(run.data.run_id || ""),
          label: String(run.data.graph_name || run.label),
          fork: Boolean(run.data.is_fork),
        },
        draggable: false,
        selectable: false,
      });
      const height = collapsed.has(run.id)
        ? 440
        : Math.max(
            650,
            735 + Math.floor(Math.max(0, outputs.length - 1) / 3) * 155,
          );
      nodes.unshift({
        id: `frame:${run.id}`,
        type: "groupbox",
        position: { x: x0, y: 220 },
        data: {
          label: `${run.data.is_fork ? "Run fork" : "Run mère"} · ${run.data.graph_name || run.label}`,
          fork: Boolean(run.data.is_fork),
        },
        style: { width: BW, height, zIndex: -20, pointerEvents: "none" },
        draggable: false,
        selectable: false,
        focusable: false,
      });
    });
  const visibleIds = new Set(Object.keys(positions));
  for (const n of payload.nodes) {
    if (!visibleIds.has(n.id)) continue;
    const section =
      n.type === "source_dataset"
        ? "dataset_source"
        : n.type === "dataset"
          ? "subset"
          : n.type === "stage"
            ? "mlflow"
            : n.type === "model"
              ? "model"
              : n.type === "artifact"
                ? n.data.artifact_kind === "annotations"
                  ? "annotations_ver"
                  : n.data.artifact_kind === "metrics"
                    ? "metrics"
                    : "artifacts"
                : "run";
    const runCompared =
      n.type === "run" ? compared.has(n.id) : compared.has(owner[n.id]);
    nodes.push({
      id: n.id,
      type: "lineage",
      position: positions[n.id],
      data: {
        kind: n.type,
        label: n.label,
        versioned: n.versioned,
        nodeId: n.id,
        graphId: String(n.data.graph_id || ""),
        runId: n.data.run_id,
        collapsed:
          n.type === "source_dataset" ? sourceCollapsed : collapsed.has(n.id),
        changed:
          runCompared &&
          (section === "run" ? changed.size > 0 : changed.has(section)),
        sub:
          n.type === "source_dataset"
            ? String(n.data.source_path || "")
            : n.type === "run"
              ? `${n.data.status || "—"} · ${n.data.git_commit ? `commit ${short(n.data.git_commit)}` : "sans commit"}`
              : n.type === "dataset"
                ? `${n.data.subset_image_count ?? "?"} images${n.data.dvc_version ? ` · dvc ${short(String(n.data.dvc_version))}` : ""}`
                : "",
      },
    });
  }
  const frameHeights = nodes
    .filter((n) => n.id.startsWith("frame:"))
    .map(
      (n) => Number((n.style as Record<string, unknown>)?.height || 0) + 260,
    );
  const maxH = sourceCollapsed ? 220 : Math.max(900, ...frameHeights);
  nodes.unshift({
    id: "frame:all",
    type: "groupbox",
    position: { x: -30, y: 10 },
    data: {
      label: "Expérience complète — source, runs, forks et productions",
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
  const edges: Edge[] = payload.edges
    .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
    .map((e) => {
      const color =
        e.kind === "source" || e.kind === "subset"
          ? "#f59e0b"
          : e.kind === "fork"
            ? "#818cf8"
            : e.kind === "model"
              ? "#34d399"
              : e.kind === "mlflow"
                ? "#a78bfa"
                : "#22d3ee";
      const fork = e.kind === "fork",
        sourceEdge = e.kind === "source",
        subset = e.kind === "subset";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: fork ? "out-right" : "out-bottom",
        targetHandle: fork ? "in-left" : "in-top",
        type: sourceEdge ? "default" : "smoothstep",
        animated: fork,
        label: fork ? "fork" : subset ? "extrait utilisé" : undefined,
        labelStyle: { fill: fork ? "#c7d2fe" : "#fbbf24", fontSize: 10 },
        labelBgStyle: { fill: "#0b1120" },
        style: {
          stroke: color,
          strokeWidth: sourceEdge ? 1.4 : 1.7,
          strokeDasharray: sourceEdge || subset || fork ? "6 5" : undefined,
          opacity: sourceEdge ? 0.75 : 1,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      };
    });
  return { nodes, edges };
}

function ComparisonPanel({
  runs,
  selected,
  setSelected,
  diffs,
  onClose,
}: {
  runs: LineageNode[];
  selected: Array<LineageNode | undefined>;
  setSelected: React.Dispatch<
    React.SetStateAction<Array<LineageNode | undefined>>
  >;
  diffs: DiffRow[];
  onClose: () => void;
}) {
  const selectRun = (index: number, id: string) => {
    const run = runs.find((r) => r.data.run_id === id);
    if (!run) return;
    setSelected((current) => {
      const next = [...current];
      next[index] = run;
      return next.slice(0, 2);
    });
  };
  const drop = (index: number, event: React.DragEvent) => {
    event.preventDefault();
    selectRun(
      index,
      event.dataTransfer.getData("application/x-lineage-run") ||
        activeRunToken ||
        "",
    );
    activeRunToken = null;
  };
  const slot = (run: LineageNode | undefined, index: number) => (
    <div
      data-compare-slot={index}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => drop(index, e)}
      onMouseUp={() => {
        if (activeRunToken) selectRun(index, activeRunToken);
        activeRunToken = null;
      }}
      onPointerUp={() => {
        if (activeRunToken) selectRun(index, activeRunToken);
        activeRunToken = null;
      }}
      className={`min-h-[84px] min-w-0 overflow-hidden rounded-xl border-2 border-dashed p-3 text-center ${index ? "border-rose-600/60 bg-rose-950/10" : "border-sky-600/60 bg-sky-950/10"}`}
    >
      {run ? (
        <>
          <p
            className={`text-xs font-semibold ${index ? "text-rose-300" : "text-sky-300"}`}
          >
            {index ? "Run fork" : "Run mère"}
          </p>
          <p className="mt-1 truncate text-[11px] text-white">
            {run.data.graph_name}
          </p>
          <p className="font-mono text-[10px] text-gray-500">
            {run.data.run_id}
          </p>
          <button
            onClick={() =>
              setSelected((current) => {
                const next = [...current];
                next[index] = undefined;
                return next;
              })
            }
            className="mt-1 text-[10px] text-gray-500"
          >
            retirer
          </button>
        </>
      ) : (
        <>
          <p className={index ? "text-rose-300" : "text-sky-300"}>
            {index ? "Run fork" : "Run mère"}
          </p>
          <p className="mt-2 text-[10px] text-gray-500">déposez le jeton</p>
        </>
      )}
    </div>
  );
  return (
    <aside className="w-[420px] shrink-0 overflow-y-auto border-l border-gray-800 bg-gray-950 shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center border-b border-gray-800 bg-gray-950 px-4 py-4">
        <GitCompareArrows size={17} className="mr-2 text-emerald-400" />
        <h2 className="flex-1 font-semibold text-white">Comparaison de runs</h2>
        <button onClick={onClose}>
          <X size={18} className="text-gray-500" />
        </button>
      </div>
      <div className="space-y-4 p-4">
        <p className="text-xs text-gray-400">
          Glissez deux jetons ici. Les éléments identiques restent discrets ;
          seules les différences sont accentuées.
        </p>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {slot(selected[0], 0)}
          <span className="text-xs text-gray-600">vs</span>
          {slot(selected[1], 1)}
        </div>
        {selected[0] && selected[1] && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Différences détectées
              </h3>
              <span className="text-[10px] text-gray-500">
                {diffs.filter((d) => d.state !== "identical").length} section(s)
              </span>
            </div>
            <div className="space-y-2">
              {diffs.map((row) => (
                <div
                  key={row.key}
                  className={`rounded-lg border p-3 ${row.state === "identical" ? "border-gray-800 bg-gray-900/40 opacity-60" : row.state === "added" ? "border-green-700/50 bg-green-950/15" : row.state === "removed" ? "border-yellow-700/50 bg-yellow-950/15" : "border-red-700/50 bg-red-950/15"}`}
                >
                  <div className="flex items-center">
                    <p
                      className={`flex-1 text-xs font-medium ${row.state === "identical" ? "text-gray-400" : row.state === "added" ? "text-green-300" : row.state === "removed" ? "text-yellow-300" : "text-red-300"}`}
                    >
                      {row.label}
                    </p>
                    <span className="rounded border border-current px-1 text-[9px]">
                      {row.state === "identical"
                        ? "identique"
                        : row.state === "modified"
                          ? "modifié"
                          : row.state === "added"
                            ? "ajouté"
                            : "supprimé"}
                    </span>
                  </div>
                  {row.state !== "identical" && (
                    <div className="mt-2 space-y-1.5">
                      {fieldDiffs(row).map((field) => (
                        <div
                          key={field.path}
                          className="rounded-md bg-black/20 px-2 py-1.5 text-[10px]"
                        >
                          <p className="mb-1 font-mono text-[9px] text-gray-500">
                            {field.path}
                          </p>
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2">
                            <p className="min-w-0 break-all text-sky-200">
                              {compact(field.left)}
                            </p>
                            <span className="text-gray-600">→</span>
                            <p className="min-w-0 break-all text-rose-200">
                              {compact(field.right)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-sky-800/50 bg-sky-950/20 p-3 text-[10px] text-sky-200">
              Une sortie absente dans le fork n’est jamais remplacée par celle
              du parent.
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function ListView({
  payload,
  diffs,
  compared,
  onSelect,
}: {
  payload: LineagePayload;
  diffs: DiffRow[];
  compared: Set<string>;
  onSelect: (node: LineageNode) => void;
}) {
  const changed = new Set(
      diffs.filter((d) => d.state !== "identical").map((d) => d.key),
    ),
    runs = payload.nodes
      .filter((n) => n.type === "run")
      .sort(
        (a, b) =>
          Number(Boolean(a.data.is_fork)) - Number(Boolean(b.data.is_fork)),
      ),
    source = payload.nodes.find((n) => n.type === "source_dataset");
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-[1500px] rounded-2xl border border-emerald-600/40 bg-emerald-950/5 p-5">
        <div className="mb-5 flex gap-3 rounded-xl border border-amber-600/50 bg-amber-950/15 p-4">
          <Database className="text-amber-400" />
          <div>
            <p className="text-xs font-semibold text-amber-300">
              Dataset source commun
            </p>
            <h2 className="text-sm text-white">
              {source?.label || "Source non identifiée"}
            </h2>
            <p className="mt-1 font-mono text-[10px] text-gray-500">
              {String(source?.data.source_path || "chemin non renseigné")}
            </p>
          </div>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          {runs.map((run) => {
            const snap = run.data.comparison ?? {},
              products = payload.edges
                .filter(
                  (e) =>
                    e.source === run.id &&
                    ["model", "mlflow", "artifact"].includes(e.kind),
                )
                .map((e) => payload.nodes.find((n) => n.id === e.target))
                .filter(Boolean) as LineageNode[];
            return (
              <section
                key={run.id}
                className={`rounded-2xl border-2 border-dashed p-4 ${run.data.is_fork ? "border-rose-600/45 bg-rose-950/10" : "border-sky-600/45 bg-sky-950/10"}`}
              >
                <div className="mb-4 flex">
                  <div className="flex-1">
                    <p
                      className={
                        run.data.is_fork
                          ? "text-xs text-rose-300"
                          : "text-xs text-sky-300"
                      }
                    >
                      {run.data.is_fork ? "Run fork" : "Run mère"}
                    </p>
                    <h3 className="text-sm text-white">
                      {run.data.graph_name}
                    </h3>
                    <p className="font-mono text-[10px] text-gray-500">
                      {run.data.run_id} · {run.data.status}
                    </p>
                  </div>
                  <button
                    onClick={() => onSelect(run)}
                    className="rounded border border-gray-700 px-2 text-[10px]"
                  >
                    Détails
                  </button>
                </div>
                <p className="mb-2 text-[10px] uppercase text-gray-500">
                  Inputs consommés
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    "dataset_source",
                    "subset",
                    "annotations_yolo",
                    "annotations_ver",
                    "hpo",
                    "training",
                  ].map((key) => (
                    <div
                      key={key}
                      className={`rounded-lg border p-3 ${compared.has(run.id) && changed.has(key) ? "border-red-600/60 bg-red-950/20" : "border-gray-800 bg-gray-900/70"}`}
                    >
                      <p className="text-[10px] text-gray-500">
                        {SECTION_LABELS[key]}
                      </p>
                      <p className="mt-1 text-xs text-gray-200">
                        {compact(snap[key])}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mb-2 mt-4 text-[10px] uppercase text-gray-500">
                  Outputs produits
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {products.map((node) => (
                    <button
                      key={node.id}
                      onClick={() => onSelect(node)}
                      className="rounded-lg border border-gray-800 bg-gray-900/70 p-3 text-left"
                    >
                      <p
                        className="text-[10px]"
                        style={{ color: META[node.type].color }}
                      >
                        {META[node.type].title}
                      </p>
                      <p className="truncate text-xs text-white">
                        {node.label}
                      </p>
                    </button>
                  ))}
                  {!products.length && (
                    <p className="col-span-3 rounded border border-dashed border-gray-800 p-3 text-xs text-gray-500">
                      Aucune production pour ce run interrompu.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({
  node,
  appUrls,
  onClose,
  onCompare,
}: {
  node: LineageNode;
  appUrls: Record<string, string>;
  onClose: () => void;
  onCompare: (n: LineageNode) => void;
}) {
  const d = node.data,
    dvc = appUrls["dvc-app"],
    mlflow = appUrls["mlflow-app"];
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const forkRun = () => {
    if (!d.graph_id || !d.run_id) return;
    setForking(true);
    setForkError(null);
    axios
      .post<{ graph_id: string }>(`/api/graphs/${d.graph_id}/fork-run`, { run_id: d.run_id })
      .then((r) => { window.location.href = `/?graph_id=${encodeURIComponent(r.data.graph_id)}`; })
      .catch((e) => setForkError(e?.response?.data?.detail || e?.message || "Fork impossible"))
      .finally(() => setForking(false));
  };
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-800 bg-gray-900">
      <div className="flex items-center border-b border-gray-800 p-4">
        <span style={{ color: META[node.type].color }}>
          {META[node.type].icon}
        </span>
        <b className="ml-2 flex-1 text-sm">{META[node.type].title}</b>
        <button onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="space-y-3 p-4">
        <h3 className="text-sm text-white">{node.label}</h3>
        {Object.entries(d)
          .filter(
            ([k, v]) =>
              !["comparison", "versioned"].includes(k) &&
              v != null &&
              typeof v !== "object",
          )
          .slice(0, 12)
          .map(([k, v]) => (
            <div
              key={k}
              className="rounded border border-gray-800 bg-gray-950 p-2"
            >
              <p className="text-[9px] uppercase text-gray-600">{k}</p>
              <p className="break-words font-mono text-[11px] text-gray-300">
                {String(v)}
              </p>
            </div>
          ))}
        {node.type === "run" && (
          <>
            <button
              onClick={() => onCompare(node)}
              className="flex w-full items-center justify-center gap-2 rounded border border-emerald-600 bg-emerald-950/30 py-2 text-xs text-emerald-300"
            >
              <GitCompareArrows size={14} />
              Comparer ce run
            </button>
            {/* Meme action que « Fork this run » de la page Insight : on ne devrait
                pas avoir a passer par Insight pour repartir d'un run vu ici. */}
            <button
              onClick={forkRun}
              disabled={forking || !d.graph_id || !d.run_id}
              title="Duplique le graphe de ce run (meme dataset, memes annotations) et enregistre sa provenance, puis ouvre le fork."
              className="flex w-full items-center justify-center gap-2 rounded border border-indigo-600 bg-indigo-950/30 py-2 text-xs text-indigo-300 disabled:opacity-50"
            >
              {forking ? <Loader2 size={14} className="animate-spin" /> : <GitFork size={14} />}
              Forker ce run
            </button>
            {forkError && <p className="text-[10px] text-red-400">{forkError}</p>}
            <div className="grid grid-cols-2 gap-2">
              {d.run_id && dvc && (
                <a
                  href={`${dvc}/lineage?run_id=${d.run_id}`}
                  className="rounded border border-indigo-700 p-2 text-center text-xs text-indigo-300"
                >
                  DVC <ExternalLink size={10} className="inline" />
                </a>
              )}
              {d.run_id && mlflow && (
                <a
                  href={`${mlflow}/lineage?run_id=${d.run_id}`}
                  className="rounded border border-violet-700 p-2 text-center text-xs text-violet-300"
                >
                  MLflow <ExternalLink size={10} className="inline" />
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function LineageInner() {
  const [payload, setPayload] = useState<LineagePayload | null>(null),
    [appUrls, setAppUrls] = useState<Record<string, string>>({}),
    [error, setError] = useState<string | null>(null),
    [selected, setSelected] = useState<LineageNode | null>(null),
    [compare, setCompare] = useState<Array<LineageNode | undefined>>([]),
    [comparisonOpen, setComparisonOpen] = useState(false),
    [view, setView] = useState<"graph" | "list">("graph"),
    [search, setSearch] = useState(""),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [sourceCollapsed, setSourceCollapsed] = useState(false),
    [flowNodes, setFlowNodes] = useState<Node[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      axios.get<LineagePayload>("/api/lineage"),
      axios.get<Record<string, string>>("/api/graphs/meta/app-urls"),
    ])
      .then(([a, b]) => {
        if (alive) {
          setPayload(a.data);
          setAppUrls(b.data || {});
        }
      })
      .catch((e) => setError(e?.message || "Chargement échoué"));
    return () => {
      alive = false;
    };
  }, []);
  const runs = useMemo(
    () => payload?.nodes.filter((n) => n.type === "run") ?? [],
    [payload],
  );
  const displayed = useMemo(() => {
    if (!payload) return null;
    const q = search.trim().toLowerCase();
    if (!q) return payload;
    const matching = new Set(
      runs
        .filter((r) =>
          [
            r.label,
            r.data.graph_name,
            r.data.run_id,
            r.data.dataset,
            r.data.subset_name,
          ].some((v) =>
            String(v || "")
              .toLowerCase()
              .includes(q),
          ),
        )
        .map((r) => r.id),
    );
    const keep = new Set(matching);
    for (const e of payload.edges) {
      if (matching.has(e.source)) keep.add(e.target);
      if (matching.has(e.target)) keep.add(e.source);
    }
    return {
      nodes: payload.nodes.filter((n) => keep.has(n.id)),
      edges: payload.edges.filter(
        (e) => keep.has(e.source) && keep.has(e.target),
      ),
    };
  }, [payload, runs, search]);
  const diffs = useMemo(() => compareRuns(compare[0], compare[1]), [compare]),
    comparedIds = useMemo(
      () =>
        new Set(
          compare.filter((n): n is LineageNode => Boolean(n)).map((n) => n.id),
        ),
      [compare],
    ),
    flow = useMemo(
      () =>
        displayed
          ? buildFlow(displayed, collapsed, sourceCollapsed, diffs, comparedIds)
          : { nodes: [], edges: [] },
      [displayed, collapsed, sourceCollapsed, diffs, comparedIds],
    );
  useEffect(() => setFlowNodes(flow.nodes), [flow.nodes]);
  useEffect(() => {
    const run = (e: Event) =>
        setCollapsed((s) => {
          const n = new Set(s),
            id = String((e as CustomEvent<string>).detail || "");
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        }),
      source = () => setSourceCollapsed((v) => !v);
    window.addEventListener("lineage:toggle-run", run);
    window.addEventListener("lineage:toggle-source", source);
    return () => {
      window.removeEventListener("lineage:toggle-run", run);
      window.removeEventListener("lineage:toggle-source", source);
    };
  }, []);
  const byId = useMemo(
    () => Object.fromEntries((payload?.nodes ?? []).map((n) => [n.id, n])),
    [payload],
  );
  const openComparison = useCallback(
    (node?: LineageNode) => {
      setComparisonOpen(true);
      setSelected(null);
      // La comparaison est un choix explicite : le bouton global ouvre deux
      // emplacements vides ; le bouton d'un run ne dépose que ce run.
      setCompare(node ? [node, undefined] : [undefined, undefined]);
    },
    [],
  );
  const allCompact = runs.length > 0 && runs.every((r) => collapsed.has(r.id));
  if (error)
    return (
      <div className="grid h-full place-items-center bg-gray-950 text-red-300">
        Erreur lineage : {error}
      </div>
    );
  if (!payload)
    return (
      <div className="grid h-full place-items-center bg-gray-950 text-gray-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  return (
    <div className="flex h-full flex-col bg-gray-950">
      <header className="flex items-center gap-3 border-b border-gray-800 px-5 py-3">
        <GitFork size={18} className="text-indigo-400" />
        <div>
          <h1 className="text-base font-semibold text-white">
            Lineage des expériences
          </h1>
          <p className="text-[10px] text-gray-500">
            Run parent → fork → différences introduites → conséquences sur les
            sorties
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setView((v) => (v === "graph" ? "list" : "graph"))}
          className="flex items-center gap-1 rounded border border-gray-700 px-2.5 py-1.5 text-xs"
        >
          {view === "graph" ? <List size={13} /> : <Network size={13} />}{" "}
          {view === "graph" ? "Liste" : "Graphe"}
        </button>
        <button
          onClick={() => setFlowNodes(flow.nodes)}
          className="flex items-center gap-1 rounded border border-gray-700 px-2.5 py-1.5 text-xs"
        >
          <LayoutGrid size={13} />
          Auto
        </button>
        <button
          onClick={() =>
            setCollapsed(
              allCompact ? new Set() : new Set(runs.map((r) => r.id)),
            )
          }
          className="flex items-center gap-1 rounded border border-gray-700 px-2.5 py-1.5 text-xs"
        >
          {allCompact ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{" "}
          {allCompact ? "Décompact" : "Compact"}
        </button>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-2.5 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Run, dataset, subset…"
            className="w-56 rounded border border-gray-700 bg-gray-900 py-1.5 pl-8 pr-2 text-xs text-white"
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {view === "graph" ? (
            <>
              <button
                onClick={() => openComparison()}
                className="absolute right-32 top-4 z-20 flex items-center gap-2 rounded-lg border border-emerald-400 bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-[0_0_18px_rgba(34,197,94,.6)]"
              >
                <GitCompareArrows size={15} />
                Comparer
              </button>
              <ReactFlow
                nodes={flowNodes}
                edges={flow.edges}
                nodeTypes={nodeTypes}
                onNodesChange={(c: NodeChange[]) =>
                  setFlowNodes((n) => applyNodeChanges(c, n))
                }
                onNodeClick={(_, n) => setSelected(byId[n.id] || null)}
                fitView
                minZoom={0.15}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} color="#1f2937" />
                <Controls />
                <MiniMap
                  nodeColor={(n) =>
                    META[(n.data as { kind?: NodeKind }).kind || "run"].color
                  }
                  maskColor="rgba(3,7,18,.78)"
                />
              </ReactFlow>
            </>
          ) : (
            <ListView
              payload={displayed || payload}
              diffs={diffs}
              compared={comparedIds}
              onSelect={setSelected}
            />
          )}
        </main>
        {comparisonOpen ? (
          <ComparisonPanel
            runs={runs}
            selected={compare}
            setSelected={setCompare}
            diffs={diffs}
            onClose={() => setComparisonOpen(false)}
          />
        ) : (
          selected && (
            <DetailPanel
              node={selected}
              appUrls={appUrls}
              onClose={() => setSelected(null)}
              onCompare={openComparison}
            />
          )
        )}
      </div>
    </div>
  );
}
export default function LineageGraphPage() {
  return (
    <ReactFlowProvider>
      <LineageInner />
    </ReactFlowProvider>
  );
}
