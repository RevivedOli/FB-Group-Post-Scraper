import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { AiUsageReport } from '@local-group-monitor/shared';
import { apiGet } from '../api/client';

function toDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatUsd(value: number) {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number) {
  return value.toLocaleString();
}

function SummaryCard({ title, value, helper }: { title: string; value: string; helper?: string }) {
  return (
    <Card sx={{ flex: '1 1 180px', minWidth: 180 }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">{title}</Typography>
        <Typography variant="h5">{value}</Typography>
        {helper ? <Typography variant="body2" color="text.secondary">{helper}</Typography> : null}
      </CardContent>
    </Card>
  );
}

export function AiUsagePage() {
  const [report, setReport] = useState<AiUsageReport>();
  const [error, setError] = useState<string>();
  const [provider, setProvider] = useState('all');
  const [model, setModel] = useState('all');
  const [preset, setPreset] = useState('30');
  const [from, setFrom] = useState(() => toDateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toDateInput(new Date()));

  useEffect(() => {
    if (preset === 'custom') return;
    const days = Number(preset);
    setFrom(toDateInput(new Date(Date.now() - days * 24 * 60 * 60 * 1000)));
    setTo(toDateInput(new Date()));
  }, [preset]);

  useEffect(() => {
    setError(undefined);
    const query = new URLSearchParams({
      from: new Date(`${from}T00:00:00.000Z`).toISOString(),
      to: new Date(`${to}T23:59:59.999Z`).toISOString(),
    });
    if (provider !== 'all') query.set('provider', provider);
    if (model !== 'all') query.set('model', model);
    apiGet<AiUsageReport>(`/ai/usage?${query.toString()}`)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [from, to, provider, model]);

  const modelOptions = useMemo(() => {
    const models = new Set((report?.byProviderModel ?? []).map((row) => row.model));
    return [...models].sort();
  }, [report]);

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h4">AI Usage</Typography>
        <Typography color="text.secondary">
          Token and estimated-cost totals by provider and model. Monetary values are estimates from captured pricing snapshots, not final provider invoices.
        </Typography>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <TextField select size="small" label="Range" value={preset} onChange={(event) => setPreset(event.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="7">Last 7 days</MenuItem>
              <MenuItem value="30">Last 30 days</MenuItem>
              <MenuItem value="90">Last 90 days</MenuItem>
              <MenuItem value="custom">Custom</MenuItem>
            </TextField>
            <TextField type="date" size="small" label="From" value={from} disabled={preset !== 'custom'} onChange={(event) => { setPreset('custom'); setFrom(event.target.value); }} InputLabelProps={{ shrink: true }} />
            <TextField type="date" size="small" label="To" value={to} disabled={preset !== 'custom'} onChange={(event) => { setPreset('custom'); setTo(event.target.value); }} InputLabelProps={{ shrink: true }} />
            <TextField select size="small" label="Provider" value={provider} onChange={(event) => { setProvider(event.target.value); setModel('all'); }} sx={{ minWidth: 180 }}>
              <MenuItem value="all">All providers</MenuItem>
              <MenuItem value="ollama">Ollama (local)</MenuItem>
              <MenuItem value="openai">OpenAI</MenuItem>
              <MenuItem value="xai">xAI / Grok</MenuItem>
              <MenuItem value="custom">Custom</MenuItem>
            </TextField>
            <TextField select size="small" label="Model" value={model} onChange={(event) => setModel(event.target.value)} sx={{ minWidth: 220 }}>
              <MenuItem value="all">All models</MenuItem>
              {modelOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      {report ? (
        <>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <SummaryCard title="Assessments" value={String(report.totals.assessmentCount)} helper={`${report.totals.completedCount} completed · ${report.totals.failedCount} failed`} />
            <SummaryCard title="Requests" value={String(report.totals.requestCount)} helper={report.totals.averageLatencyMs != null ? `avg ${(report.totals.averageLatencyMs / 1000).toFixed(1)}s` : undefined} />
            <SummaryCard title="Total tokens" value={formatTokens(report.totals.totalTokens)} helper={`${formatTokens(report.totals.inputTokens)} in · ${formatTokens(report.totals.cachedInputTokens)} cached · ${formatTokens(report.totals.outputTokens)} out`} />
            <SummaryCard
              title="Estimated cost"
              value={formatUsd(report.totals.estimatedCostUsd)}
              helper={provider === 'ollama' || report.byProviderModel.every((row) => row.provider === 'ollama') ? 'Local / $0 estimated' : 'Remote / estimated USD'}
            />
          </Stack>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>By provider and model</Typography>
              {report.byProviderModel.length === 0 ? (
                <Typography color="text.secondary">No completed or failed assessments in this range.</Typography>
              ) : (
                <Stack spacing={1.25}>
                  {report.byProviderModel.map((row) => (
                    <Card key={`${row.provider}-${row.model}`} variant="outlined">
                      <CardContent>
                        <Stack spacing={0.5}>
                          <Typography fontWeight={700}>{row.providerLabel} · {row.model}</Typography>
                          <Typography color="text.secondary">
                            {row.assessmentCount} assessments · {row.requestCount} requests · {formatTokens(row.totalTokens)} tokens · {formatUsd(row.estimatedCostUsd)} estimated
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {formatTokens(row.inputTokens)} in · {formatTokens(row.cachedInputTokens)} cached · {formatTokens(row.outputTokens)} out
                            {row.averageLatencyMs != null ? ` · avg ${(row.averageLatencyMs / 1000).toFixed(1)}s` : ''}
                            {row.provider === 'ollama' ? ' · Local / $0 estimated' : ' · Remote / estimated USD'}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>Daily usage</Typography>
              {report.byDay.length === 0 ? (
                <Typography color="text.secondary">No daily usage in this range.</Typography>
              ) : (
                <Stack spacing={1}>
                  {report.byDay.map((row) => (
                    <Stack key={row.date} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.5}>
                      <Typography fontWeight={650}>{row.date}</Typography>
                      <Typography color="text.secondary">
                        {row.assessmentCount} assessments · {formatTokens(row.totalTokens)} tokens · {formatUsd(row.estimatedCostUsd)}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </>
      ) : !error ? (
        <Typography color="text.secondary">Loading usage…</Typography>
      ) : null}
    </Stack>
  );
}
