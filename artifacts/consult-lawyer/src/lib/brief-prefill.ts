import type { Consultation, Template } from '@workspace/api-client-react';

// Template field ids that can be safely seeded from the client's brief.
// Everything stays editable; the lawyer reviews each value before creating the draft.
const FIELD_SOURCES: Record<string, (c: Consultation, today: string) => string> = {
  synopsis: (c) => c.brief?.whatHappened ?? '',
  briefFacts: (c) => c.brief?.whatHappened ?? '',
  breachDetails: (c) => c.brief?.whatHappened ?? '',
  transactionDetails: (c) => c.brief?.whatHappened ?? '',
  deficiencyDetails: (c) => c.brief?.whatHappened ?? '',
  grounds: (c) => c.brief?.whatHappened ?? '',
  listOfDates: (c) => c.brief?.keyDates ?? '',
  place: (c) => c.brief?.location ?? '',
  causeOfActionPlace: (c) => c.brief?.location ?? '',
  courtLocation: (c) => c.brief?.location ?? '',
  respondentName: (c) => c.brief?.otherParty ?? '',
  oppositePartyName: (c) => c.brief?.otherParty ?? '',
  defendantName: (c) => c.brief?.otherParty ?? '',
  recipientName: (c) => c.brief?.otherParty ?? '',
  specificRelief: (c) => c.brief?.desiredOutcome ?? '',
  petitionerName: (c) => c.clientName,
  plaintiffName: (c) => c.clientName,
  complainantName: (c) => c.clientName,
  applicantName: (c) => c.clientName,
  clientName: (c) => c.clientName,
  partyName: (c) => c.clientName,
  deponentName: (c) => c.clientName,
  principalName: (c) => c.clientName,
  advocateName: (c) => c.lawyerName,
  aorName: (c) => c.lawyerName,
  noticeSubject: (c) => c.topic,
  date: (_c, today) => today,
};

export function prefillFromBrief(template: Template, c: Consultation): Record<string, string> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const values: Record<string, string> = {};
  for (const field of template.fields) {
    const value = FIELD_SOURCES[field.id]?.(c, today)?.trim();
    if (value) values[field.id] = value;
  }
  return values;
}
