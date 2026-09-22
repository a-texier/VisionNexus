import DatasetNode from './DatasetNode'
import ModelNode   from './ModelNode'
import AppNode     from './AppNode'

export const nodeTypes = {
  dataset_source: DatasetNode,
  model:          ModelNode,
  explorer:           AppNode,
  annotation:     AppNode,
  dvc:            AppNode,
  mlflow:         AppNode,
  optuna:         AppNode,
  training:       AppNode,
  inference:      AppNode,
}

export type { DatasetNodeData } from './DatasetNode'
export type { ModelNodeData } from './ModelNode'
export type { AppNodeData, AppNodeType } from './AppNode'
export type { NodeExecStatus } from './shared'
