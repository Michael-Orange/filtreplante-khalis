/**
 * Gestion des mots de passe en Base64
 * Remplace CryptoJS AES — compatible Drizzle ORM, zéro dépendance
 *
 * Pour le dual-write (rétrocompat Replit), le Worker auth utilise
 * aussi CryptoJS pour écrire dans password_encrypted en parallèle.
 */

export function encodePassword(password: string): string {
  return btoa(password);
}

export function decodePassword(encoded: string): string {
  return atob(encoded);
}

export function verifyPassword(password: string, encoded: string): boolean {
  try {
    return password === atob(encoded);
  } catch {
    return false;
  }
}
