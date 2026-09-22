// ============================================================
// DocPage.tsx — documentation applicative de l'app MLflow.
// Pas de théorie générique répétée (voir le Guide MLOps dans
// l'Orchestrator) : ici, comment MLflow est réellement utilisé
// dans CETTE suite + un exemple concret.
// ============================================================

import { FlaskConical, GitBranch, BarChart2, Link2, BookOpen, ArrowRight } from 'lucide-react'
import { useT } from '../i18n/useLang'

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="text-[12px] text-gray-400 leading-relaxed space-y-1.5">{children}</div>
    </div>
  )
}

export default function DocPage() {
  const t = useT()
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <BookOpen size={22} className="text-indigo-400" />
        <h1 className="text-xl font-semibold text-white">{t('Documentation — MLflow dans cette suite')}</h1>
      </div>

      <p className="text-sm text-gray-400 leading-relaxed">
        {t('MLflow répond à :')} <b className="text-gray-200">{t('quelle expérience a été exécutée, avec quels paramètres, métriques et artifacts ?')}</b>{' '}
        {t('Le cadre conceptuel (Git vs DVC vs MLflow) est dans le')} <b className="text-indigo-300">Guide MLOps</b> {t("de l'Orchestrator. Ici : l'usage réel.")}
      </p>

      {/* Applicatif réel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card icon={<FlaskConical size={15} className="text-indigo-400" />} title={t('Expériences / Runs')}>
          <p>Store <b>serverless</b> {t(': un fichier SQLite dans le workspace')}
          {' '}(<span className="font-mono">mlflow_&lt;user&gt;/mlflow_data/mlflow.db</span>){t('. Training, Inference/Éval y écrivent directement ; cette app le lit. Aucun serveur, aucun port.')}</p>
        </Card>
        <Card icon={<BarChart2 size={15} className="text-indigo-400" />} title={t('Comparer')}>
          <p>{t("Compare N runs côte à côte (params + métriques) pour voir l'effet d'un HPO ou d'un changement de dataset.")}</p>
        </Card>
        <Card icon={<GitBranch size={15} className="text-indigo-400" />} title="Model Registry">
          <p>{t('Le')} <span className="font-mono">best.pt</span> {t("est enregistré comme version de modèle liée au run qui l'a produit.")}</p>
        </Card>
      </div>

      {/* Nommage + tags de lineage */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Link2 size={15} className="text-indigo-400" />
          <h3 className="text-sm font-semibold text-white">{t('Nommage et tags de lineage')}</h3>
        </div>
        <p className="text-[12px] text-gray-400 leading-relaxed">
          {t("Lancé par l'Orchestrator, un run est nommé")} <span className="font-mono">graph_id/NodeLabel</span>{' '}
          {t('(fini les noms aléatoires) et porte des')} <b>{t('tags de lineage')}</b> : <span className="font-mono">orch_run_id</span>{' '}
          {t('(le run orchestrateur exact),')} <span className="font-mono">graph_id</span>{t(', puis après le commit DVC')}
          <span className="font-mono"> git_commit</span> {t('et')} <span className="font-mono">dataset_version</span>.
          {t('Ils apparaissent dans la section')} <b>Lineage</b> {t("du détail d'un run — c'est ce qui relie le run à son code (Git) et à ses données (DVC).")}
        </p>
      </div>

      {/* Exemple concret */}
      <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white">{t('Exemple réel')}</h3>
        <pre className="text-[11px] font-mono text-gray-300 bg-black/30 rounded-lg p-3 overflow-x-auto">{`run  a34bafc5   6a3cb30d/Training final (best params)
  metrics: mAP50B=0.6994  mAP50-95B=0.3514  ...
  tags:    orch_run_id=6c94d495  graph_id=6a3cb30d
           git_commit=41ef68b3  dataset_version=6f652d0a`}</pre>
        <p className="text-[12px] text-gray-400 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-purple-300">run a34bafc5</span>
          <ArrowRight size={12} className="text-gray-600" />
          <span className="font-mono text-indigo-300">git 41ef68b3</span>
          <ArrowRight size={12} className="text-gray-600" />
          <span className="font-mono text-emerald-300">dataset 6f652d0a</span>
          <ArrowRight size={12} className="text-gray-600" />
          <span>{t('= expérience entièrement traçable et reproductible.')}</span>
        </p>
      </div>
    </div>
  )
}
