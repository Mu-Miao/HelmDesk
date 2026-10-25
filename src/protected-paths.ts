/** Shared project boundary: these host/account directories never enter model workspaces. */
export const protectedDirectoryNames = new Set([
  '.aws', '.codex', '.agents', '.qoder', '.qoder-cn', '.qoderworkcn', '.ssh',
  '.zcode', '.zcode-beta', '.auth', '.models', '.gnupg', '.azure', '.kube', '.docker', '.gemini', '.antigravity', '.arkcli', '.arkcli-bytecloud',
]);

export function protectedProjectEntry(name: string) {
  return protectedDirectoryNames.has(name.toLowerCase()) ||
    /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|\.netrc|\.npmrc|credentials(?:\.[a-z0-9_-]+)?)$/i.test(name) ||
    /\.(?:pem|key|p12|pfx|keystore)$/i.test(name);
}
