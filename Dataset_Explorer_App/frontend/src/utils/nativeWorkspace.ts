type Bridge = {
  openInNativeFileManager(path: string, mappings?: Array<{ backendRoot: string; clientRoot: string }>): Promise<{ ok: boolean; error?: string }>
}

export async function openInNativeFileManager(path: string): Promise<void> {
  const native = (window as typeof window & { __CV_NATIVE_MOUNT__?: Bridge }).__CV_NATIVE_MOUNT__
  if (!native) throw new Error("L'ouverture native nécessite VisionNexus sur le poste Windows.")
  const result = await native.openInNativeFileManager(path)
  if (!result.ok) throw new Error(result.error || `Impossible d'ouvrir ${path}`)
}
