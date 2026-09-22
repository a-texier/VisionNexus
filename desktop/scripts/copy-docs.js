// ============================================================
// desktop/scripts/copy-docs.js
// Copie la doc de chaque app (docs/*.md, ou README.md a defaut) dans
// desktop/docs-bundle/<AppDir>/ avant le packaging electron-builder
// (extraResources la reprend telle quelle, cf. package.json). Regenere a
// chaque build -- jamais commite, jamais edite a la main.
//
// Pourquoi : jusqu'ici l'onglet "Docs par app" ne lisait QUE le depot en
// clair a cote du lanceur (findRepoRoot() dans main.ts) -- rien sur une
// machine qui n'a pas le depot complet a portee (poste utilisateur avec
// juste l'exe portable). Ce bundle sert de repli garanti quand le disque
// live n'est pas trouve ; le disque live reste prioritaire quand il l'est
// (toujours plus a jour que ce qui a ete fige au build).
// ============================================================
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')      // Computer_Vision_App/
const OUT = path.join(__dirname, '..', 'docs-bundle')

const APP_DOC_DIRS = {
  orchestrator: 'Orchestrator_App',
  explorer: 'Dataset_Explorer_App',
  annotation: 'Annotation_App',
  optuna: 'Optuna_App',
  training: 'Training_App',
  inference: 'Inference_App',
  mlflow: 'MLflow_App',
  dvc: 'DVC_App',
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

let total = 0
for (const appDirName of Object.values(APP_DOC_DIRS)) {
  const appDir = path.join(ROOT, appDirName)
  const docsDir = path.join(appDir, 'docs')
  const dest = path.join(OUT, appDirName)
  const copied = []

  if (fs.existsSync(docsDir)) {
    fs.mkdirSync(dest, { recursive: true })
    for (const f of fs.readdirSync(docsDir)) {
      if (!f.toLowerCase().endsWith('.md')) continue
      fs.copyFileSync(path.join(docsDir, f), path.join(dest, f))
      copied.push(f)
    }
  } else {
    const readme = path.join(appDir, 'README.md')
    if (fs.existsSync(readme)) {
      fs.mkdirSync(dest, { recursive: true })
      fs.copyFileSync(readme, path.join(dest, 'README.md'))
      copied.push('README.md')
    }
  }
  // Pages ajoutees par les plugins presents (plugins/<plugin>/docs/<AppDir>/),
  // meme regle que readPluginDocs() dans main.ts.
  const pluginsDir = path.join(ROOT, 'plugins')
  if (fs.existsSync(pluginsDir)) {
    for (const plugin of fs.readdirSync(pluginsDir).sort()) {
      const pluginDocs = path.join(pluginsDir, plugin, 'docs', appDirName)
      if (!fs.existsSync(pluginDocs)) continue
      fs.mkdirSync(dest, { recursive: true })
      for (const f of fs.readdirSync(pluginDocs)) {
        if (!f.toLowerCase().endsWith('.md')) continue
        fs.copyFileSync(path.join(pluginDocs, f), path.join(dest, f))
        copied.push(f)
      }
    }
  }
  if (copied.length) {
    console.log(`  + ${appDirName} (${copied.length} fichier(s))`)
    total += copied.length
  } else {
    console.log(`  [!] ${appDirName} : aucune doc trouvee (ni docs/, ni README.md)`)
  }
}
console.log(`docs-bundle/ pret -- ${total} fichier(s) au total`)
