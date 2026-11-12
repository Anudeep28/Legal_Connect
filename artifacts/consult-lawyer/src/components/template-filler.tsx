import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, FilePlus2 } from 'lucide-react';
import type { Template } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { fillTemplate } from '@/lib/format';

export function TemplateFiller({
  template,
  onCreate,
  pending,
  ctaLabel = 'Create document',
  disabledReason,
}: {
  template: Template;
  onCreate?: (content: string, values: Record<string, string>) => void;
  pending?: boolean;
  ctaLabel?: string;
  disabledReason?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const filled = useMemo(() => fillTemplate(template.content, values), [template.content, values]);
  const missing = template.fields.filter((f) => f.required && !values[f.id]?.trim());

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
      <div className="space-y-3">
        {template.fields.length === 0 && <p className="text-sm text-muted-foreground">This template has no fields to fill.</p>}
        {template.fields.map((f) => (
          <div key={f.id}>
            <Label htmlFor={`f-${f.id}`} className="text-[13px]">
              {f.name} {f.required && <span className="text-destructive">*</span>}
            </Label>
            {f.type === 'textarea' ? (
              <Textarea id={`f-${f.id}`} rows={3} className="mt-1" placeholder={f.placeholder} value={values[f.id] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} data-testid={`input-field-${f.id}`} />
            ) : (
              <Input
                id={`f-${f.id}`}
                type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                className="mt-1"
                placeholder={f.placeholder}
                value={values[f.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                data-testid={`input-field-${f.id}`}
              />
            )}
          </div>
        ))}
        {onCreate && (
          <div className="pt-2">
            <Button className="w-full" disabled={pending || missing.length > 0 || !!disabledReason} onClick={() => onCreate(filled, values)} data-testid="button-create-from-template">
              {pending ? <Loader2 className="animate-spin" /> : <FilePlus2 />} {ctaLabel}
            </Button>
            {disabledReason ? (
              <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p>
            ) : missing.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Fill {missing.length} required {missing.length === 1 ? 'field' : 'fields'} to continue.</p>
            ) : null}
          </div>
        )}
      </div>
      <div className="max-h-[60vh] overflow-y-auto rounded-2xl border bg-[hsl(42_60%_99%)] p-6 shadow-inner">
        <article className="prose prose-sm max-w-none font-serif prose-headings:font-display">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{filled}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
