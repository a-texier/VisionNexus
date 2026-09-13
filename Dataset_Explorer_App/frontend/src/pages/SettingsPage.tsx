// ============================================================
// pages/SettingsPage.tsx
// Paramètres utilisateur persistants dans le workspace.
// ============================================================

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Settings, Save, FolderOpen, Database, Info, RefreshCw, Palette, Network } from 'lucide-react'
import { settingsAPI } from '../api/client'
import { BG_THEMES, ACCENT_THEMES, applyTheme } from '../components/ThemeProvider'
import type { AppSettings } from '../types/api'

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    settingsAPI.get()
      .then(s => { setSettings(s); setDraft(s) })
      .catch(() => toast.error('Impossible de charger les paramètres'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await settingsAPI.update(draft)
      setSettings(saved)
      setDraft(saved)
      // Appliquer le thème immédiatement
      applyTheme(saved.theme_bg ?? 'dark-gray', saved.theme_accent ?? 'indigo')
      toast.success('Paramètres sauvegardés — thème appliqué')
    } catch {
      toast.error('Erreur sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  const handlePreviewTheme = (bg: string, accent: string) => {
    applyTheme(bg, accent)
  }

  const hasChanges = draft && settings && JSON.stringify(draft) !== JSON.stringify(settings)

  if (loading) return <div className="p-6 text-gray-500">Chargement...</div>
  if (!draft) return <div className="p-6 text-red-400">Impossible de charger les paramètres.</div>

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings size={22} /> Paramètres
        </h1>
        <p className="text-gray-400 mt-1">
          Stockés dans <code className="text-gray-300 text-xs bg-gray-800 px-1.5 py-0.5 rounded">
            {settings?.workspace_path}/settings.json
          </code>
        </p>
      </div>

      {/* Workspace */}
      <Section title="Workspace" icon={<Database size={16} />}>
        <InfoRow label="Chemin workspace" value={settings?.workspace_path ?? '—'}
          hint="Configurable via EXPLORER_WORKSPACE dans launcher.py" readOnly />
        <InfoRow label="Base de données" value={`${settings?.workspace_path ?? ''}/dataset_explorer.db`} readOnly />
        <InfoRow label="Thumbnails" value={`${settings?.workspace_path ?? ''}/thumbs/`} readOnly />
        <InfoRow label="Index FAISS" value={`${settings?.workspace_path ?? ''}/faiss/`} readOnly />
      </Section>

      {/* Export */}
      <Section title="Export Annotation App" icon={<FolderOpen size={16} />}>
        <div className="space-y-2">
          <label className="block text-sm text-gray-400">Dossier d'imports</label>
          <input
            type="text"
            value={draft.annotation_app_imports_path}
            onChange={e => setDraft({ ...draft, annotation_app_imports_path: e.target.value })}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500"
            placeholder="C:\...\Annotation_App\data\imports"
          />
          <p className="text-xs text-gray-500">
            Les subsets exportés créeront un sous-dossier ici.
            Configurable aussi via <code className="text-gray-400">ANNOTATION_APP_IMPORTS</code> dans launcher.py.
          </p>
        </div>
      </Section>

      {/* Subsets & symlinks */}
      <Section title="Subsets & liens" icon={<FolderOpen size={16} />}>
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <label className="block text-sm text-gray-300 font-medium mb-1">Stratégie de liens</label>
            <p className="text-xs text-gray-500 mb-3">
              Définit comment les fichiers sont référencés dans les subsets et exports.
              <strong className="text-gray-400"> Symlinks</strong> = lien symbolique (aucune copie, rapide, recommandé).
              <strong className="text-gray-400"> Copie</strong> = copie physique (lent, consomme de l'espace, mais universel).
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDraft({ ...draft, use_symlinks: true })}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm transition-all ${
                  draft.use_symlinks
                    ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300 font-medium'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                Symlinks (recommandé)
                {draft.use_symlinks && <span className="text-xs">✓</span>}
              </button>
              <button
                onClick={() => setDraft({ ...draft, use_symlinks: false })}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm transition-all ${
                  !draft.use_symlinks
                    ? 'border-amber-500 bg-amber-600/20 text-amber-300 font-medium'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                Copie physique
                {!draft.use_symlinks && <span className="text-xs">✓</span>}
              </button>
            </div>
            {draft.use_symlinks && (
              <p className="text-xs text-yellow-500/80 mt-2">
                Windows : nécessite le <strong>Mode Développeur</strong> (Paramètres → Pour les développeurs → Mode développeur : ON) ou droits admin.
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* Réduction dimensionnelle */}
      <Section title="Réduction dimensionnelle" icon={<Network size={16} />}>
        <p className="text-xs text-gray-500">
          Méthode utilisée pour projeter les embeddings CLIP (512D) en 2D sur la Carte.
          Appliquée à chaque pipeline d'embedding. Les hyperparamètres sont sauvegardés et utilisés
          pour toutes les nouvelles exécutions.
        </p>
        <div className="space-y-1">
          <label className="block text-sm text-gray-300 font-medium">Méthode</label>
          <div className="flex gap-2">
            {(['umap', 'tsne', 'pca'] as const).map(m => (
              <button
                key={m}
                onClick={() => setDraft({ ...draft, reduction_method: m })}
                className={`px-4 py-2 rounded-lg border-2 text-sm transition-all font-mono ${
                  draft.reduction_method === m
                    ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300 font-medium'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                {m === 'umap' ? 'UMAP' : m === 'tsne' ? 't-SNE' : 'PCA'}
                {draft.reduction_method === m && ' ✓'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {draft.reduction_method === 'umap' && 'UMAP : recommandé, meilleure préservation de la structure locale et globale.'}
            {draft.reduction_method === 'tsne' && 't-SNE : clusters bien séparés, mais distances inter-clusters peu fiables.'}
            {draft.reduction_method === 'pca' && 'PCA : déterministe et rapide, moins expressif sur les grands datasets.'}
          </p>
        </div>

        {/* Hyperparamètres UMAP */}
        {draft.reduction_method === 'umap' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">n_neighbors</label>
              <input type="number" min={2} max={200}
                value={draft.umap_n_neighbors}
                onChange={e => setDraft({ ...draft, umap_n_neighbors: Number(e.target.value) })}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-600 mt-1">Voisins locaux considérés (défaut : 15)</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">min_dist</label>
              <input type="number" min={0.001} max={1} step={0.01}
                value={draft.umap_min_dist}
                onChange={e => setDraft({ ...draft, umap_min_dist: Number(e.target.value) })}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-600 mt-1">Distance minimale entre points (défaut : 0.1)</p>
            </div>
          </div>
        )}

        {/* Hyperparamètres t-SNE */}
        {draft.reduction_method === 'tsne' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Perplexité</label>
              <input type="number" min={5} max={100}
                value={draft.tsne_perplexity}
                onChange={e => setDraft({ ...draft, tsne_perplexity: Number(e.target.value) })}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-600 mt-1">Balance local/global (défaut : 30)</p>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Learning rate</label>
              <input type="number" min={10} max={1000} step={10}
                value={draft.tsne_learning_rate}
                onChange={e => setDraft({ ...draft, tsne_learning_rate: Number(e.target.value) })}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-600 mt-1">Vitesse d'apprentissage (défaut : 200)</p>
            </div>
          </div>
        )}

        {/* PCA : pas de paramètre */}
        {draft.reduction_method === 'pca' && (
          <p className="text-xs text-gray-500 italic">
            PCA : pas de paramètre spécifique. Toujours 2 composantes principales.
          </p>
        )}
      </Section>

      {/* Clustering */}
      <Section title="Clustering" icon={<RefreshCw size={16} />}>
        <div className="space-y-1">
          <label className="block text-sm text-gray-300 font-medium">Méthode par défaut</label>
          <div className="flex gap-2">
            {(['kmeans', 'hdbscan'] as const).map(m => (
              <button key={m}
                onClick={() => setDraft({ ...draft, cluster_method: m })}
                className={`px-4 py-2 rounded-lg border-2 text-sm transition-all font-mono ${
                  draft.cluster_method === m
                    ? 'border-teal-500 bg-teal-600/20 text-teal-300 font-medium'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}>
                {m === 'kmeans' ? 'KMeans' : 'HDBSCAN'}
                {draft.cluster_method === m && ' ✓'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {draft.cluster_method === 'kmeans' && 'KMeans : nombre de clusters fixé (n_clusters), rapide et déterministe.'}
            {draft.cluster_method === 'hdbscan' && 'HDBSCAN : détecte automatiquement le nombre de clusters + le bruit (min_cluster_size).'}
          </p>
        </div>
        {draft.cluster_method === 'hdbscan' && (
          <div className="max-w-xs">
            <label className="block text-sm text-gray-400 mb-1">min_cluster_size</label>
            <input type="number" min={2} max={200}
              value={draft.hdbscan_min_cluster_size}
              onChange={e => setDraft({ ...draft, hdbscan_min_cluster_size: Math.max(2, Number(e.target.value)) })}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-600 mt-1">Taille minimale d'un cluster (défaut : 5)</p>
          </div>
        )}
      </Section>

      {/* Pipeline defaults */}
      <Section title="Valeurs par défaut" icon={<RefreshCw size={16} />}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Clusters KMeans</label>
            <input type="number" min={2} max={100}
              value={draft.default_n_clusters}
              onChange={e => setDraft({ ...draft, default_n_clusters: Number(e.target.value) })}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-500 mt-1">Par défaut à la création de dataset</p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Top-K recherche</label>
            <input type="number" min={5} max={200}
              value={draft.default_top_k}
              onChange={e => setDraft({ ...draft, default_top_k: Number(e.target.value) })}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-500 mt-1">Résultats par défaut en recherche sémantique</p>
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Mode couleur carte UMAP (défaut)</label>
          <select value={draft.scatter_default_color}
            onChange={e => setDraft({ ...draft, scatter_default_color: e.target.value })}
            className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200">
            <option value="cluster">Par cluster</option>
            <option value="rarity">Par rareté</option>
            <option value="uniform">Uniforme</option>
          </select>
        </div>
      </Section>

      {/* ---- Thème visuel ---- */}
      <Section title="Thème visuel" icon={<Palette size={16} />}>
        <p className="text-xs text-gray-500">
          Choisissez un fond et une couleur d'accent pour personnaliser l'atmosphère de l'app.
          Cliquez sur un thème pour le prévisualiser instantanément — sauvegardez pour le conserver.
        </p>

        {/* Fond */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Fond de l'application</label>
          <div className="grid grid-cols-5 gap-2">
            {Object.entries(BG_THEMES).map(([key, theme]) => (
              <button
                key={key}
                onClick={() => {
                  setDraft(d => d ? { ...d, theme_bg: key } : d)
                  handlePreviewTheme(key, draft.theme_accent ?? 'indigo')
                }}
                className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                  draft.theme_bg === key ? 'border-white scale-105' : 'border-gray-700 hover:border-gray-500'
                }`}
                title={theme.label}
              >
                {/* Preview color swatch */}
                <div className="h-14" style={{ backgroundColor: theme.preview }}>
                  <div className="h-full w-full flex flex-col justify-end p-1.5">
                    <div className="h-1 rounded-full bg-white/20 mb-1" />
                    <div className="h-1 rounded-full bg-white/10 w-3/4" />
                  </div>
                </div>
                <div className="bg-gray-900 px-1.5 py-1 text-center">
                  <p className="text-xs text-gray-300 truncate leading-tight">{theme.label}</p>
                </div>
                {draft.theme_bg === key && (
                  <div className="absolute top-1 right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                    <span className="text-gray-900 text-xs font-bold">✓</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Accent */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Couleur d'accent</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(ACCENT_THEMES).map(([key, theme]) => (
              <button
                key={key}
                onClick={() => {
                  setDraft(d => d ? { ...d, theme_accent: key } : d)
                  handlePreviewTheme(draft.theme_bg ?? 'dark-gray', key)
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 transition-all text-sm ${
                  draft.theme_accent === key
                    ? 'border-white text-white font-medium'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: theme.color }} />
                {theme.label}
                {draft.theme_accent === key && <span className="text-xs">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Aperçu bouton */}
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
          <p className="text-xs text-gray-500 mb-2">Aperçu des éléments interactifs :</p>
          <div className="flex flex-wrap gap-2">
            <button className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg">
              Bouton principal
            </button>
            <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-600/20 text-indigo-400 border border-indigo-600/40 flex items-center">
              Badge accent
            </span>
            <div className="h-2 w-32 bg-gray-800 rounded-full overflow-hidden flex items-center">
              <div className="h-full w-2/3 bg-indigo-500 rounded-full" />
            </div>
          </div>
        </div>
      </Section>

      {/* Guide technique */}
      <Section title="Guide technique" icon={<Info size={16} />}>
        <div className="space-y-3 text-sm text-gray-400">
          <TechCard title="Invariant FAISS">
            Position <code className="text-indigo-300">i</code> dans l'index = Image rang <code className="text-indigo-300">i</code> triée par <code className="text-indigo-300">Image.id</code> ascendant. Ne jamais ajouter d'images sans reconstruire l'index.
          </TechCard>
          <TechCard title="Normalisation L2">
            Tous les embeddings CLIP sont L2-normalisés. Similarité cosinus = produit scalaire (dot product) → FAISS IndexFlatIP.
          </TechCard>
          <TechCard title="Symlinks Windows">
            Nécessitent le Mode Développeur ou droits admin. Configurable ci-dessus : activez "Copie physique" pour éviter cette restriction.
          </TechCard>
          <TechCard title="Ports réseau">
            <span className="text-gray-500">Backend FastAPI</span> <span className="text-white ml-2">:8001</span>
            <span className="text-gray-500 ml-4">Frontend</span> <span className="text-white ml-2">:5173</span>
            <span className="text-gray-500 ml-4">Annotation App</span> <span className="text-white ml-2">:8000</span>
          </TechCard>
        </div>
      </Section>

      {/* Sauvegarder */}
      <div className="flex justify-end pt-2">
        <button onClick={handleSave} disabled={saving || !hasChanges}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg font-medium transition-colors">
          <Save size={16} />
          {saving ? 'Sauvegarde...' : hasChanges ? 'Sauvegarder les modifications' : 'Aucune modification'}
        </button>
      </div>
    </div>
  )
}

// ---- Sous-composants ----

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2 uppercase tracking-wide">
        <span className="text-indigo-400">{icon}</span>
        {title}
      </h2>
      {children}
    </div>
  )
}

function InfoRow({ label, value, hint, readOnly }: {
  label: string; value: string; hint?: string; readOnly?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-gray-400 truncate font-mono">{value}</code>
        {readOnly && <span className="text-xs text-gray-600 whitespace-nowrap">lecture seule</span>}
      </div>
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  )
}

function TechCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-lg p-3 border border-gray-700">
      <p className="text-gray-300 font-medium mb-1">{title}</p>
      <p className="text-gray-400 text-xs">{children}</p>
    </div>
  )
}
