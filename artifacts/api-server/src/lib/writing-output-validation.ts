import { ADVOCATE_REVIEW_NOTE } from "./writing-prompts";

export type WritingOutputValidation =
  | { valid: true }
  | { valid: false; reason: "missing_review_note" | "protected_fact_missing" };

const protectedValueLabels = new Set([
  "client",
  "applicant",
  "petitioner",
  "respondent",
  "plaintiff",
  "defendant",
  "complainant",
  "accused",
  "witness",
  "party",
  "name",
  "reference",
  "reference number",
  "case reference",
  "case number",
  "receipt reference",
  "receipt number",
  "payment id",
  "order id",
  "account number",
  "policy number",
  "contract number",
  "नाम",
  "ग्राहक",
  "आवेदक",
  "याचिकाकर्ता",
  "प्रतिवादी",
  "शिकायतकर्ता",
  "आरोपी",
  "गवाह",
  "संदर्भ",
  "मामला संख्या",
  "केस नंबर",
  "नाव",
  "ग्राहक",
  "अर्जदार",
  "याचिकाकर्ता",
  "प्रतिवादी",
  "तक्रारदार",
  "आरोपी",
  "साक्षीदार",
  "संदर्भ",
  "प्रकरण क्रमांक",
  "केस क्रमांक",
]);

const decimalDigitRanges: Array<[start: number, end: number]> = [
  [0x0660, 0x0669],
  [0x06f0, 0x06f9],
  [0x0966, 0x096f],
  [0x09e6, 0x09ef],
  [0x0a66, 0x0a6f],
  [0x0ae6, 0x0aef],
  [0x0b66, 0x0b6f],
  [0x0be6, 0x0bef],
  [0x0c66, 0x0c6f],
  [0x0ce6, 0x0cef],
  [0x0d66, 0x0d6f],
];

function normalizeLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[`*_#-]/gu, "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ");
}

function normalizeFactValue(value: string): string {
  return value.normalize("NFKC").trim();
}

function normalizeNumericToken(value: string): string {
  const asciiDigits = Array.from(value.normalize("NFKC"), (character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return character;
    const digitRange = decimalDigitRanges.find(([start, end]) => codePoint >= start && codePoint <= end);
    return digitRange ? String(codePoint - digitRange[0]) : character;
  }).join("");
  return asciiDigits.replace(/,/gu, "");
}

function extractProtectedTextValues(source: string): string[] {
  const protectedValues = new Set<string>();
  const labelledValue = /^\s*([^:：=]{1,48})\s*[:：=]\s*(.*?)\s*$/u;

  for (const value of source.matchAll(/\[[^\]\r\n]{1,120}\]/gu)) {
    if (value[0]) protectedValues.add(normalizeFactValue(value[0]));
  }

  for (const line of source.split(/\r?\n/u)) {
    const match = labelledValue.exec(line);
    if (!match || !protectedValueLabels.has(normalizeLabel(match[1] ?? ""))) continue;
    const value = (match[2] ?? "").replace(/[.,;]+\s*$/u, "").trim();
    if (value && value.length <= 160) protectedValues.add(normalizeFactValue(value));
  }

  return [...protectedValues];
}

function extractProtectedNumbers(source: string): Set<string> {
  return new Set(
    (source.match(/\p{Nd}+(?:,\p{Nd}{3})*(?:\.\p{Nd}+)?/gu) ?? [])
      .map(normalizeNumericToken),
  );
}

function startsWithReviewNote(output: string): boolean {
  const firstContent = output
    .trimStart()
    .replace(/^(?:#{1,6}\s+|>\s*|[-+*]\s*)/u, "")
    .replace(/^(?:\*\*|__|`)/u, "");
  return firstContent.startsWith(ADVOCATE_REVIEW_NOTE);
}

export function validateWritingOutput(source: string, output: string): WritingOutputValidation {
  if (!startsWithReviewNote(output)) return { valid: false, reason: "missing_review_note" };

  const normalizedOutput = normalizeFactValue(output);
  const protectedTextValues = extractProtectedTextValues(source);
  if (protectedTextValues.some((value) => !normalizedOutput.includes(value))) {
    return { valid: false, reason: "protected_fact_missing" };
  }

  const outputNumbers = extractProtectedNumbers(output);
  const protectedNumbers = extractProtectedNumbers(source);
  if ([...protectedNumbers].some((number) => !outputNumbers.has(number))) {
    return { valid: false, reason: "protected_fact_missing" };
  }

  return { valid: true };
}
