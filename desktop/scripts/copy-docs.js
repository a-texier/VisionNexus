// ============================================================
// desktop/scripts/copy-docs.js
// Copie la doc de chaque source du manifest (<dir>/docs/*.md ou `docs_path`,
// README.md + README.fr.md a defaut) dans desktop/docs-bundle/<AppDir>/, plus le
// manifest lui-meme, avant le packaging electron-builder
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

// Liste des apps documentees : source unique partagee avec main.ts et
// tools/docs/. Copiee aussi dans le bundle pour l'exe sans depot a cote.
const MANIFEST = path.join(ROOT, 'docs', 'docs_manifest.json')
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'))

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

fs.copyFileSync(MANIFEST, path.join(OUT, 'docs_manifest.json'))

let total = 0
for (const source of manifest.sources) {
  const appDirName = source.dir
  const appDir = path.join(ROOT, appDirName)
  const docsDir = path.join(ROOT, source.docs_path || path.join(appDirName, 'docs'))
  // Meme regle que sourceBundleDir() (src/docFiles.ts) : la suite a dir "."
  // et ne peut pas prendre la racine du bundle.
  const dest = path.join(OUT, appDirName === '.' ? source.id : appDirName)
  const copied = []

  if (fs.existsSync(docsDir)) {
    fs.mkdirSync(dest, { recursive: true })
    for (const f of fs.readdirSync(docsDir)) {
      if (!f.toLowerCase().endsWith('.md')) continue
      fs.copyFileSync(path.join(docsDir, f), path.join(dest, f))
      copied.push(f)
    }
    // Images referencees par les pages (liens relatifs assets/...).
    const assetsDir = path.join(docsDir, 'assets')
    // Sans assets/demo (GIF de plusieurs Mo destine au README, pas aux pages).
    if (fs.existsSync(assetsDir)) {
      fs.cpSync(assetsDir, path.join(dest, 'assets'), { recursive: true, filter: (src) => path.basename(src) !== 'demo' })
    }
  } else {
    // Les deux langues : main.ts choisit README.fr.md en FR, avec repli.
    for (const f of ['README.md', 'README.fr.md']) {
      const readme = path.join(appDir, f)
      if (!fs.existsSync(readme)) continue
      fs.mkdirSync(dest, { recursive: true })
      fs.copyFileSync(readme, path.join(dest, f))
      copied.push(f)
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
    console.log(`  + ${source.id} (${copied.length} fichier(s))`)
    total += copied.length
  } else {
    console.log(`  [!] ${source.id} : aucune doc trouvee (ni docs/, ni README.md)`)
  }
}
console.log(`docs-bundle/ pret -- ${total} fichier(s) au total`)
