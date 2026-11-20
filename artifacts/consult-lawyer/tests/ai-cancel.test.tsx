import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import DocumentEditor from '@/pages/document-editor';
import ConsultationDetail from '@/pages/consultation-detail';

// Only replace identity and unrelated chrome/calling/export code. Real pages,
// disclosure dialogs, mutation hooks and API client run against an offline transport.
vi.mock('@/lib/account', () => ({ useAccount: () => ({ signedIn: true, me: { id: 'fictional-lawyer', role: 'lawyer', status: 'active' } }) }));
vi.mock('@/components/shell', () => ({ AppPage: ({ children }: React.PropsWithChildren) => children }));
vi.mock('@/components/consultation-call', () => ({ ConsultationCall: () => null }));
vi.mock('@/lib/export', () => ({}));

const text = 'Fictional workshop notes about a blue notebook.';
const date = '2026-01-02T12:00:00Z';
const allowance = { remaining: 5, limit: 5 };
const reads: Record<string, unknown> = {
  '/api/documents/demo': { id: 'demo', title: 'Practice notes', content: text, language: 'English', updatedAt: date },
  '/api/platform': { draftingEnabled: true, dictationEnabled: true, languages: ['English', 'Hindi'], templates: [{ id: 'practice', name: 'Practice template', fields: [] }] },
  '/api/writing/usage': { drafting: allowance, transcription: allowance, resetsAt: date },
  '/api/consultations/demo': { id: 'demo', userId: 'fictional-client', clientName: 'Fictional Client', mode: 'call', package: 'consultation_document', paymentStatus: 'paid', status: 'completed', topic: text, notes: text, transcript: text, startsAt: date, endsAt: date, fee: 0 },
  '/api/consultations/demo/call-transcripts': [{ id: 'session', status: 'ready', editedTranscript: text, detectedLanguages: ['English'], createdAt: date }],
  '/api/consultations/demo/messages': [], '/api/consultations/demo/deliverables': [],
};
let unexpected: string[];
let client: QueryClient;
beforeEach(() => {
  unexpected = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method === 'GET' && Object.hasOwn(reads, path)) return Response.json(reads[path]);
    unexpected.push(`${method} ${path}`);
    throw new Error('Unexpected request blocked by offline test');
  });
});
afterEach(() => {
  cleanup(); client.clear(); vi.unstubAllGlobals();
  expect(unexpected).toEqual([]);
});
function mount(section: 'documents' | 'consultations') {
  const { hook } = memoryLocation({ path: `/${section}/demo` });
  render(<QueryClientProvider client={client}><Router hook={hook}><Route path={`/${section}/:id`}>{section === 'documents' ? <DocumentEditor /> : <ConsultationDetail />}</Route></Router></QueryClientProvider>);
  return userEvent.setup();
}
async function cancel(user: ReturnType<typeof userEvent.setup>, prefix: string, provider: string) {
  const dialog = await screen.findByTestId(`${prefix}-ai-consent-dialog`);
  expect(within(dialog).getByRole('heading').textContent).toContain(provider);
  expect(unexpected).toEqual([]);
  await user.click(within(dialog).getByTestId(`${prefix}-ai-cancel`));
  await waitFor(() => expect(dialog.isConnected).toBe(false));
  expect(unexpected).toEqual([]);
}
for (const action of ['Draft a formal document from notes', 'Improve wording and structure', 'Translate']) {
  it(`cancel ${action} without sending document text`, async () => {
    const user = mount('documents');
    await user.click(await screen.findByTestId('button-ai-menu'));
    await user.click(await screen.findByText(action, { exact: true }));
    await cancel(user, 'document-writing', 'DeepSeek');
    expect((screen.getByTestId('input-doc-content') as HTMLTextAreaElement).value).toBe(text);
  });
}
it('cancel dictation without uploading audio', async () => {
  const stopTrack = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) } });
  vi.stubGlobal('MediaRecorder', class {
    static isTypeSupported() { return true; }
    state = 'inactive'; ondataavailable!: (e: { data: Blob }) => void; onstop!: () => void;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob([new Uint8Array(64)]) }); this.onstop(); }
  });
  const user = mount('documents');
  await user.click(await screen.findByTestId('button-record'));
  await user.click(await screen.findByTestId('button-stop-recording'));
  await cancel(user, 'document-dictation', 'ElevenLabs');
  expect(stopTrack).toHaveBeenCalledOnce();
  expect((screen.getByTestId('input-doc-content') as HTMLTextAreaElement).value).toBe(text);
});
it('cancel a private call transcript draft without sending the transcript or template', async () => {
  const user = mount('consultations');
  await user.click(await screen.findByTestId('button-generate-call-draft-session'));
  await cancel(user, 'call-draft-session', 'DeepSeek');
  expect((screen.getByTestId('input-call-transcript-session') as HTMLTextAreaElement).value).toBe(text);
});
it('cancel a deliverable draft without sending consultation notes', async () => {
  const user = mount('consultations');
  await user.click(await screen.findByTestId('button-new-deliverable'));
  await user.click(await screen.findByTestId('button-ai-draft'));
  await cancel(user, 'consultation-deliverable-draft', 'DeepSeek');
  expect((screen.getByTestId('input-deliverable-content') as HTMLTextAreaElement).value).toBe('');
});
