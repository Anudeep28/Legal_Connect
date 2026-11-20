export type PolicySection = {
  blockIndex: number;
  number: string;
  title: string;
  id: string;
};

const sectionHeading = /^(\d+)\.\s+([A-Z][A-Z\s&,'()-]+)$/;

export function getPolicySections(blocks: string[]): PolicySection[] {
  return blocks.flatMap((block, blockIndex) => {
    const title = block.trim();
    const match = sectionHeading.exec(title);
    if (!match) return [];

    return [{
      blockIndex,
      number: match[1],
      title,
      id: `policy-section-${match[1]}`,
    }];
  });
}
