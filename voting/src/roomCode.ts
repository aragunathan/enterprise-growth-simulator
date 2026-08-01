// Excludes visually ambiguous characters (0/O, 1/I) since players read this off a shared screen.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function generateUniqueRoomCode(existingCodes: { has(code: string): boolean }): string {
  let code: string;
  do {
    code = generateRoomCode();
  } while (existingCodes.has(code));
  return code;
}
