// ============================================================
// DocPage.tsx — documentation applicative de l'app DVC.
// Pas de théorie générique répétée (voir le Guide MLOps dans
// l'Orchestrator) : ici, comment DVC est réellement utilisé dans
// CETTE app + un exemple concret sur le repo.
// ============================================================

import { Database, GitCommit, GitCompare, RefreshCw, Upload, Download, BookOpen, ArrowRight } from 'lucide-react'
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
        <h1 className="text-xl font-semibold text-white">{t('Documentation — DVC dans cette app')}</h1>
      </div>

      <p className="text-sm text-gray-400 leading-relaxed">
        {t('DVC (Data Version Control) répond à une question :')} <b className="text-gray-200">{t("quelle version exacte des données / modèles lourds a été utilisée ?")}</b> {t('Le pourquoi conceptuel (Git vs DVC vs MLflow) est expliqué dans le')} <b className="text-indigo-300">{t('Guide MLOps')}</b> {t("de l'Orchestrator. Cette page se concentre sur l'usage réel ici.")}
      </p>

      {/* Applicatif réel : les 4 pages */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card icon={<Database size={15} className="text-indigo-400" />} title="Datasets">
          <p>{t('Liste les fichiers/dossiers réellement suivis par DVC dans ce repo, avec leur taille, leur empreinte (')}<span className="font-mono">md5</span>{t(' = identifiant de version) et leur statut (à jour / modifié / manquant).')}</p>
        </Card>
        <Card icon={<GitCommit size={15} className="text-indigo-400" />} title={t('Historique')}>
          <p>{t('Chaque commit git touchant un')} <span className="font-mono">.dvc</span> {t('= une version. Les puces Dataset / Run / mAP viennent des')} <b>{t('trailers')}</b> {t("posés par l'Orchestrator au moment du commit — elles traduisent le commit brut en information MLOps.")}</p>
        </Card>
        <Card icon={<GitCompare size={15} className="text-indigo-400" />} title={t('Diff')}>
          <p>{t("Compare deux versions. On affiche d'abord un")} <b>{t('résumé métier')}</b> {t("(+N/−N images, annotations modifiées, run qui a utilisé la version cible), puis le détail fichier par fichier. Si une info n'est pas dans les trailers, c'est indiqué, jamais inventé.")}</p>
        </Card>
        <Card icon={<RefreshCw size={15} className="text-indigo-400" />} title={t('Sync')}>
          <p>{t('Push / Pull DVC vers/depuis le remote, avec la source')} → {t('destination réelle et un log temps réel. Sans remote configuré, l\'action est bloquée avec un message clair.')}</p>
        </Card>
      </div>

      {/* Push / Pull : quand et pourquoi */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white">{t('Push / Pull : quand et pourquoi')}</h3>
        <div className="flex items-start gap-2 text-[12px] text-gray-400">
          <Upload size={15} className="text-blue-400 mt-0.5 shrink-0" />
          <p><b className="text-blue-300">Push</b> {t('après avoir versionné un nouveau dataset/modèle, pour que le contenu lourd soit récupérable depuis une autre machine (VM GPU, collègue). Git seul ne stocke que les pointeurs')} <span className="font-mono">.dvc</span> {t('; le contenu part au remote.')}</p>
        </div>
        <div className="flex items-start gap-2 text-[12px] text-gray-400">
          <Download size={15} className="text-emerald-400 mt-0.5 shrink-0" />
          <p><b className="text-emerald-300">Pull</b> {t('après un')} <span className="font-mono">git checkout</span> {t("d'une version, pour rapatrier le contenu exact correspondant (reproduire un run à l'identique).")}</p>
        </div>
      </div>

      {/* Exemple concret */}
      <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white">{t('Exemple réel')}</h3>
        <p className="text-[12px] text-gray-400">
          {t("Un run d'entraînement produit un dataset YOLO et un")} <span className="font-mono">best.pt</span>{t('. Depuis le nœud DVC de l\'Orchestrator, on commit ces artefacts : le repo devient')}
        </p>
        <pre className="text-[11px] font-mono text-gray-300 bg-black/30 rounded-lg p-3 overflow-x-auto">{`41ef68b3  feat: demo voiture - dataset YOLO + best.pt (mAP50=0.70)

  Run-Id: 6c94d495
  Graph-Id: 6a3cb30d
  Dataset: Annot_voiture_demo-yolo
  mAP50: 0.7000
  MLflow-Run: a34bafc5

+ datasets/Annot_voiture_demo-yolo.dvc   (md5 dir, 401 Mo, 201 fichiers)
+ models/best.pt.dvc                     (md5 37fb8f09, 6.2 Mo)`}</pre>
        <p className="text-[12px] text-gray-400 flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-indigo-300">41ef68b3</span>
          <ArrowRight size={12} className="text-gray-600" />
          <span>{t('version code+config')}</span>
          <ArrowRight size={12} className="text-gray-600" />
          <span className="font-mono text-emerald-300">.dvc</span>
          <span>{t('= version exacte des données')}</span>
          <ArrowRight size={12} className="text-gray-600" />
          <span className="font-mono text-purple-300">MLflow a34bafc5</span>
          <span>{t("= run qui l'a utilisée.")}</span>
        </p>
      </div>
    </div>
  )
}
