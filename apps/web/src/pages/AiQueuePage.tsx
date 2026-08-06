import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Collapse, Dialog, DialogContent, DialogTitle, Divider, Link, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import type { AiPricingSnapshot, AiStatus } from '@local-group-monitor/shared';
import { apiGet, apiSend } from '../api/client';

interface AiAssessment {
  id: string;
  status: string;
  intent?: string | null;
  isReferralOpportunity?: boolean | null;
  confidence?: number | null;
  summary?: string | null;
  errorMessage?: string | null;
  model?: string | null;
  provider?: string | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  requestCount?: number | null;
  estimatedCostUsd?: number | null;
  durationMs?: number | null;
  pricingSnapshot?: AiPricingSnapshot | null;
  promptVersion?: string | null;
  promptText?: string | null;
  renderedPrompt?: string | null;
  inputPayload?: unknown;
  rawResponse?: unknown;
  parsed?: unknown;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  post?: {
    id: string;
    canonicalPostUrl: string;
    latestCapturedText?: string | null;
    authorName?: string | null;
    originalTimestampLabel?: string | null;
    originalPostedAt?: string | null;
    extractionConfidence?: number | null;
    group?: { friendlyName: string };
  };
  memberMatches?: Array<{
    id: string;
    score?: number;
    scorePercent: string;
    reason?: string | null;
    suggestedIntro?: string | null;
    referralMember?: {
      id: string;
      name: string;
      businessName?: string | null;
      facebookName?: string | null;
      facebookProfileUrl?: string | null;
      category: string;
      keywords?: string | null;
      servicesOffered?: string | null;
      idealReferral?: string | null;
      negativeKeywords?: string | null;
    };
  }>;
}

interface AssessmentListResponse {
  items: AiAssessment[];
  total: number;
}

interface ReferralMember {
  id: string;
  name: string;
  businessName?: string | null;
  category: string;
}

interface ReferralDirectoryResponse {
  members: ReferralMember[];
}

interface AiActivityEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  assessmentId?: string;
  postUrl?: string;
  createdAt: string;
}

interface AiActivityResponse {
  processorRunning: boolean;
  processorStartedAt?: string | null;
  currentAssessmentId?: string | null;
  currentPostUrl?: string | null;
  currentPostUrls?: string[];
  activeJobCount?: number;
  processedInCurrentRun: number;
  items: AiActivityEntry[];
}

function ageLabel(value?: string | null) {
  if (!value) return 'not started';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatAiActionMessage(kind: 'queue' | 'process' | 'rerun', result: Record<string, unknown>) {
  if (kind === 'process') {
    const started = result.started === true;
    return started ? 'AI processor started. It will keep running until the queue is empty.' : 'AI processor is already running.';
  }
  const queued = (result.queued && typeof result.queued === 'object') ? result.queued as Record<string, unknown> : result;
  const inspected = typeof queued.inspected === 'number' ? queued.inspected : 0;
  const queuedCount = typeof queued.queued === 'number' ? queued.queued : 0;
  const skipped = typeof queued.skipped === 'number' ? queued.skipped : 0;
  return kind === 'rerun'
    ? `Queued ${queuedCount} rerun item(s). Inspected ${inspected}, skipped ${skipped}.`
    : `Queued ${queuedCount} item(s). Inspected ${inspected}, skipped ${skipped}.`;
}

function shortUrl(url: string) {
  return url.replace(/^https:\/\/www\.facebook\.com\//, 'facebook.com/');
}

function usageLine(item: AiAssessment) {
  return [
    item.provider,
    item.model,
    typeof item.inputTokens === 'number' ? `${item.inputTokens.toLocaleString()} in` : undefined,
    typeof item.cachedInputTokens === 'number' ? `${item.cachedInputTokens.toLocaleString()} cached` : undefined,
    typeof item.outputTokens === 'number' ? `${item.outputTokens.toLocaleString()} out` : undefined,
    typeof item.totalTokens === 'number' ? `${item.totalTokens.toLocaleString()} total` : undefined,
    typeof item.durationMs === 'number' ? `${(item.durationMs / 1000).toFixed(1)}s` : undefined,
    typeof item.estimatedCostUsd === 'number' ? `est. $${item.estimatedCostUsd.toFixed(5)}` : undefined,
  ].filter(Boolean).join(' · ');
}

function skipReasonLabel(reason?: string | null) {
  switch (reason) {
    case 'prefilter_no_match':
      return 'No trigger phrase';
    case 'ai_disabled':
      return 'AI disabled';
    case 'missing_real_permalink':
      return 'Missing permalink';
    case 'missing_post_context':
      return 'Missing post text';
    case 'low_extraction_confidence':
      return 'Low extraction confidence';
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Skipped';
  }
}

export function AiQueuePage() {
  const [status, setStatus] = useState<AiStatus>();
  const [items, setItems] = useState<AiAssessment[]>([]);
  const [activity, setActivity] = useState<AiActivityResponse>();
  const [members, setMembers] = useState<ReferralMember[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [intentFilter, setIntentFilter] = useState('all');
  const [referralFilter, setReferralFilter] = useState('all');
  const [matchFilter, setMatchFilter] = useState('all');
  const [memberFilter, setMemberFilter] = useState('all');
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AiAssessment>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [activityExpanded, setActivityExpanded] = useState(false);

  async function load() {
    setError(undefined);
    try {
      const query = new URLSearchParams({
        status: statusFilter,
        intent: intentFilter,
        referral: referralFilter,
        match: matchFilter,
        pageSize: '50',
      });
      if (memberFilter !== 'all') query.set('memberId', memberFilter);
      if (confidenceFilter !== 'all') query.set('minConfidence', confidenceFilter);
      if (search.trim()) query.set('search', search.trim());
      const [nextStatus, nextList, nextActivity] = await Promise.all([
        apiGet<AiStatus>('/ai/status'),
        apiGet<AssessmentListResponse>(`/ai/assessments?${query.toString()}`),
        apiGet<AiActivityResponse>('/ai/activity'),
      ]);
      setStatus(nextStatus);
      setItems(nextList.items);
      setTotal(nextList.total);
      setActivity(nextActivity);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    apiGet<ReferralDirectoryResponse>('/referrals')
      .then((directory) => setMembers(directory.members))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => { void load(); }, [statusFilter, intentFilter, referralFilter, matchFilter, memberFilter, confidenceFilter, search]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, status?.processorRunning || (status?.counts.running ?? 0) > 0 || (status?.counts.pending ?? 0) > 0 ? 2500 : 10000);
    return () => window.clearInterval(timer);
  }, [statusFilter, intentFilter, referralFilter, matchFilter, memberFilter, confidenceFilter, search, status?.processorRunning, status?.counts.running, status?.counts.pending]);

  async function action(kind: 'queue' | 'process' | 'rerun') {
    setBusy(kind);
    setMessage(undefined);
    setError(undefined);
    try {
      const path = kind === 'queue' ? '/ai/queue' : kind === 'process' ? '/ai/process' : '/ai/rerun-all';
      const result = await apiSend<Record<string, unknown>>(path, 'POST', { limit: 1000 });
      setMessage(formatAiActionMessage(kind, result));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function resetStale() {
    setBusy('reset-stale');
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await apiSend<{ reset: number; threshold: string }>('/ai/reset-stale', 'POST', { maxAgeSeconds: status?.staleRunningThresholdSeconds ?? 300 });
      setMessage(`Re-queued ${result.reset} stale running item(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function requeueItem(item: AiAssessment, bypassPrefilter = false) {
    setBusy(`requeue:${item.id}`);
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await apiSend<{ queued: boolean; reason?: string }>(`/ai/assessments/${item.id}/requeue`, 'POST', {
        process: true,
        bypassPrefilter,
      });
      setMessage(result.queued
        ? 'Re-queued item and started the processor.'
        : `Item not queued: ${(result.reason ?? 'unknown').replaceAll('_', ' ')}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function requeueFailed() {
    setBusy('requeue-failed');
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await apiSend<{ inspected: number; queued: number; skipped: number; failed: number }>('/ai/requeue-failed', 'POST', {
        status: 'failed',
        limit: 500,
        process: true,
        bypassPrefilter: true,
      });
      setMessage(`Retry failed: inspected ${result.inspected}, re-queued ${result.queued}, still skipped ${result.skipped}, errors ${result.failed}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h4">Referral Queue</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button onClick={() => void load()}>Refresh</Button>
          <Button variant="outlined" disabled={Boolean(busy)} onClick={() => void action('queue')}>{busy === 'queue' ? 'Queueing...' : 'Queue Eligible'}</Button>
          <Button variant="contained" disabled={Boolean(busy)} onClick={() => void action('process')}>{busy === 'process' ? 'Processing...' : 'Process Queue'}</Button>
          <Button color="warning" disabled={Boolean(busy) || !(status?.counts.failed)} onClick={() => void requeueFailed()}>
            {busy === 'requeue-failed' ? 'Retrying...' : `Retry Failed${status?.counts.failed ? ` (${status.counts.failed})` : ''}`}
          </Button>
          <Button color="warning" disabled={Boolean(busy)} onClick={() => void resetStale()}>{busy === 'reset-stale' ? 'Resetting...' : 'Reset Stale'}</Button>
          <Button color="warning" disabled={Boolean(busy)} onClick={() => void action('rerun')}>{busy === 'rerun' ? 'Queueing...' : 'Rerun Current Prompt'}</Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success">{message}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}

      {status && (
        <Card>
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={status.enabled ? 'AI enabled' : 'AI disabled'} color={status.enabled ? 'success' : 'default'} />
                <Chip label={status.autoAnalyse ? 'Auto analysis on' : 'Auto analysis off'} />
                <Chip label={`${status.providerLabel}: ${status.providerHealth?.reachable ? 'ready' : 'not ready'}`} color={status.providerHealth?.reachable ? 'success' : 'warning'} />
                {status.provider === 'ollama' ? (
                  <Chip label={status.ollamaReachable ? 'Ollama reachable' : 'Ollama offline'} color={status.ollamaReachable ? 'success' : 'warning'} />
                ) : null}
                <Chip label={status.processorRunning ? 'Processor running' : 'Processor idle'} />
                <Chip label={`${status.providerLabel} · ${status.model}`} />
                <Chip label={`Concurrency ${status.effectiveConcurrency ?? 1}${status.provider === 'ollama' ? ' (local)' : ''}`} />
                {(status.activeJobCount ?? 0) > 0 && <Chip label={`${status.activeJobCount} active`} color="warning" />}
                {status.oldestRunningStartedAt && <Chip label={`Oldest running ${ageLabel(String(status.oldestRunningStartedAt))}`} color="warning" />}
              </Stack>
              <Typography color="text.secondary">
                {status.providerHealth?.detail || status.baseUrl || status.ollamaBaseUrl}
                {' · '}prompt {status.promptVersion}
                {' · '}stale after {ageLabel(new Date(Date.now() - status.staleRunningThresholdSeconds * 1000).toISOString())}
                {status.provider !== 'ollama' ? ` · remote concurrency setting ${status.remoteConcurrency ?? 5}` : ''}
              </Typography>
              {status.counts.running > 0 && !status.processorRunning && (
                <Alert severity="warning">There are running rows but the worker is idle. Use Reset Stale, then Process Queue.</Alert>
              )}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {Object.entries(status.counts).map(([key, value]) => <Chip key={key} label={`${key}: ${value}`} />)}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {activity && (
        <Card>
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="h6">AI Activity</Typography>
                  <Chip label={activity.processorRunning ? 'Worker active' : 'Worker idle'} color={activity.processorRunning ? 'success' : 'default'} />
                  {activity.processorStartedAt && <Chip label={`Running ${ageLabel(activity.processorStartedAt)}`} color="warning" />}
                  <Chip label={`Processed this run: ${activity.processedInCurrentRun ?? 0}`} />
                </Stack>
                <Button size="small" onClick={() => setActivityExpanded((value) => !value)}>
                  {activityExpanded ? 'Hide activity' : 'Show activity'}
                </Button>
              </Stack>
              {(activity.currentPostUrls?.length || activity.currentPostUrl) ? (
                <Stack spacing={0.25}>
                  <Typography color="text.secondary">
                    Active request{(activity.currentPostUrls?.length ?? 0) > 1 ? 's' : ''}:
                  </Typography>
                  {(activity.currentPostUrls?.length ? activity.currentPostUrls : activity.currentPostUrl ? [activity.currentPostUrl] : []).map((url) => (
                    <Typography key={url} color="text.secondary">
                      <Link href={url} target="_blank" rel="noreferrer">{shortUrl(url)}</Link>
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography color="text.secondary">No active AI request.</Typography>
              )}
              <Collapse in={activityExpanded} timeout="auto" unmountOnExit>
                <Stack spacing={0.75}>
                  {activity.items.length === 0 ? (
                    <Typography color="text.secondary">No AI worker events yet.</Typography>
                  ) : activity.items.slice(0, 12).map((entry) => (
                    <Alert key={entry.id} severity={entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warning' : 'info'} sx={{ py: 0.25 }}>
                      {new Date(entry.createdAt).toLocaleTimeString()} · {entry.message}
                      {entry.postUrl && (
                        <>
                          {' '}
                          <Link href={entry.postUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                            Open post
                          </Link>
                        </>
                      )}
                    </Alert>
                  ))}
                </Stack>
              </Collapse>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField select size="small" label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} sx={{ width: 180 }}>
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="running">Running</MenuItem>
              <MenuItem value="completed">Completed</MenuItem>
              <MenuItem value="failed">Failed</MenuItem>
              <MenuItem value="skipped">Skipped</MenuItem>
            </TextField>
            <TextField select size="small" label="Intent" value={intentFilter} onChange={(event) => setIntentFilter(event.target.value)} sx={{ width: 190 }}>
              <MenuItem value="all">All intents</MenuItem>
              <MenuItem value="looking_for_help">Looking for help</MenuItem>
              <MenuItem value="advertising">Advertising</MenuItem>
              <MenuItem value="discussion">Discussion</MenuItem>
              <MenuItem value="irrelevant">Irrelevant</MenuItem>
            </TextField>
            <TextField select size="small" label="Referral" value={referralFilter} onChange={(event) => setReferralFilter(event.target.value)} sx={{ width: 210 }}>
              <MenuItem value="all">All referral states</MenuItem>
              <MenuItem value="opportunity">Referral opportunities</MenuItem>
              <MenuItem value="not_referral">Not referral</MenuItem>
            </TextField>
            <TextField select size="small" label="Matches" value={matchFilter} onChange={(event) => setMatchFilter(event.target.value)} sx={{ width: 190 }}>
              <MenuItem value="all">Any matches</MenuItem>
              <MenuItem value="with_matches">Has member match</MenuItem>
              <MenuItem value="without_matches">No member match</MenuItem>
            </TextField>
            <TextField select size="small" label="Member" value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} sx={{ width: 220 }}>
              <MenuItem value="all">Any member</MenuItem>
              {members.map((member) => (
                <MenuItem key={member.id} value={member.id}>{member.name} · {member.category}</MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="AI confidence" value={confidenceFilter} onChange={(event) => setConfidenceFilter(event.target.value)} sx={{ width: 180 }}>
              <MenuItem value="all">Any confidence</MenuItem>
              <MenuItem value="0.25">25%+</MenuItem>
              <MenuItem value="0.5">50%+</MenuItem>
              <MenuItem value="0.75">75%+</MenuItem>
              <MenuItem value="0.9">90%+</MenuItem>
            </TextField>
            <TextField size="small" label="Search" value={search} onChange={(event) => setSearch(event.target.value)} sx={{ width: 280 }} />
            <Button
              onClick={() => {
                setStatusFilter('all');
                setIntentFilter('all');
                setReferralFilter('all');
                setMatchFilter('all');
                setMemberFilter('all');
                setConfidenceFilter('all');
                setSearch('');
              }}
            >
              Clear
            </Button>
            <Typography color="text.secondary">{total} assessment(s)</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Stack spacing={2}>
        {items.length === 0 ? (
          <Card><CardContent><Typography color="text.secondary">No AI assessments match this view.</Typography></CardContent></Card>
        ) : items.map((item) => (
          <Card key={item.id} onClick={() => setSelected(item)} sx={{ cursor: 'pointer' }}>
            <CardContent>
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={item.status} color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'skipped' ? 'warning' : 'default'} />
                  {item.status === 'skipped' && item.errorMessage ? <Chip size="small" label={skipReasonLabel(item.errorMessage)} color="warning" variant="outlined" /> : null}
                  {item.intent && <Chip size="small" label={item.intent} />}
                  {item.isReferralOpportunity !== undefined && item.status !== 'skipped' && <Chip size="small" label={item.isReferralOpportunity ? 'Referral opportunity' : 'Not referral'} />}
                  {typeof item.confidence === 'number' && <Chip size="small" label={`AI confidence ${Math.round(item.confidence * 100)}%`} />}
                  {item.post?.group?.friendlyName && <Chip size="small" label={item.post.group.friendlyName} />}
                  {item.status === 'running' && <Chip size="small" label={`Running ${ageLabel(item.startedAt)}`} color="warning" />}
                </Stack>
                {(item.summary || item.errorMessage) && (
                  <Alert
                    severity={item.status === 'failed' ? 'error' : item.status === 'skipped' ? 'warning' : item.isReferralOpportunity ? 'success' : 'info'}
                    sx={{ '& .MuiAlert-message': { width: '100%' } }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                      {item.status === 'skipped' ? 'Skip reason' : item.status === 'failed' ? 'Error' : 'AI summary'}
                    </Typography>
                    <Typography>{item.summary || item.errorMessage}</Typography>
                  </Alert>
                )}
                <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                  {item.post?.latestCapturedText || 'No post text captured.'}
                </Typography>
                {item.memberMatches && item.memberMatches.length > 0 && (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {item.memberMatches.map((match) => (
                      <Chip key={match.id} size="small" label={`${match.referralMember?.name ?? 'Member'} ${match.scorePercent}`} />
                    ))}
                  </Stack>
                )}
                <Typography color="text.secondary">{item.post?.canonicalPostUrl}</Typography>
                <Typography color="text.secondary">Created {new Date(item.createdAt).toLocaleString()}{item.completedAt ? ` · Completed ${new Date(item.completedAt).toLocaleString()}` : ''}</Typography>
                {usageLine(item) && <Typography variant="body2" color="text.secondary">{usageLine(item)}</Typography>}
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button size="small" onClick={(event) => { event.stopPropagation(); setSelected(item); }}>View decision details</Button>
                  {(item.status === 'failed' || item.status === 'skipped') && (
                    <Button
                      size="small"
                      color="warning"
                      disabled={Boolean(busy)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void requeueItem(item, item.status === 'failed');
                      }}
                    >
                      {busy === `requeue:${item.id}` ? 'Re-queueing...' : 'Re-add to queue'}
                    </Button>
                  )}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <AssessmentDetailsDialog assessment={selected} onClose={() => setSelected(undefined)} />
    </Stack>
  );
}

function jsonBlock(value: unknown) {
  if (value === null || value === undefined) return 'None stored.';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function codePanel(value: unknown) {
  return (
    <Box component="pre" sx={{ bgcolor: 'action.hover', borderRadius: 1, overflow: 'auto', p: 2, fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 520 }}>
      {jsonBlock(value)}
    </Box>
  );
}

function AssessmentDetailsDialog({ assessment, onClose }: { assessment?: AiAssessment; onClose: () => void }) {
  const [tab, setTab] = useState('recommendation');
  const [rawTab, setRawTab] = useState('prompt');
  if (!assessment) return null;
  return (
    <Dialog open={Boolean(assessment)} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>AI Assessment Details</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tab value="recommendation" label={`Recommendation (${assessment.memberMatches?.length ?? 0})`} />
            <Tab value="raw" label="AI Raw Data" />
          </Tabs>

          {tab === 'recommendation' && (
            <Stack spacing={2.5}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={assessment.status} color={assessment.status === 'completed' ? 'success' : assessment.status === 'failed' ? 'error' : 'default'} />
                {assessment.intent && <Chip size="small" label={assessment.intent} />}
                {assessment.isReferralOpportunity !== undefined && <Chip size="small" label={assessment.isReferralOpportunity ? 'Referral opportunity' : 'Not referral'} />}
                {typeof assessment.confidence === 'number' && <Chip size="small" label={`AI confidence ${Math.round(assessment.confidence * 100)}%`} />}
                {assessment.provider && <Chip size="small" label={assessment.provider} />}
                {assessment.model && <Chip size="small" label={assessment.model} />}
                {typeof assessment.totalTokens === 'number' && <Chip size="small" label={`${assessment.totalTokens.toLocaleString()} tokens`} />}
                {typeof assessment.estimatedCostUsd === 'number' && <Chip size="small" label={`est. $${assessment.estimatedCostUsd.toFixed(5)}`} />}
              </Stack>

              <Box>
                <Typography variant="overline" color="text.secondary">AI summary</Typography>
                <Typography>{assessment.summary || assessment.errorMessage || 'No AI summary stored.'}</Typography>
              </Box>

              <Box>
                <Typography variant="overline" color="text.secondary">Usage</Typography>
                <Typography>{usageLine(assessment) || 'No usage stored.'}</Typography>
                {assessment.pricingSnapshot ? (
                  <Typography color="text.secondary">
                    Pricing snapshot {assessment.pricingSnapshot.catalogVersion}: ${assessment.pricingSnapshot.inputCostPerMillion}/${assessment.pricingSnapshot.cachedInputCostPerMillion}/${assessment.pricingSnapshot.outputCostPerMillion} per 1M in/cached/out
                  </Typography>
                ) : null}
              </Box>

              <Box>
                <Typography variant="overline" color="text.secondary">Original post</Typography>
                <Typography sx={{ whiteSpace: 'pre-wrap' }}>{assessment.post?.latestCapturedText || 'No post text stored.'}</Typography>
                {assessment.post?.canonicalPostUrl && (
                  <Link href={assessment.post.canonicalPostUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                    {assessment.post.canonicalPostUrl}
                  </Link>
                )}
                <Typography color="text.secondary">
                  {assessment.post?.authorName ? `${assessment.post.authorName} · ` : ''}
                  {assessment.post?.group?.friendlyName ?? 'Unknown group'}
                  {typeof assessment.post?.extractionConfidence === 'number' ? ` · extraction ${Math.round(assessment.post.extractionConfidence * 100)}%` : ''}
                </Typography>
              </Box>

              <Divider />

              <Stack spacing={1.5}>
                <Typography variant="h6">Member Match Reasoning</Typography>
                {assessment.memberMatches && assessment.memberMatches.length > 0 ? assessment.memberMatches.map((match) => (
                  <Card key={match.id} variant="outlined">
                    <CardContent>
                      <Stack spacing={1}>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Chip label={match.referralMember?.name ?? 'Unknown member'} />
                          {match.referralMember?.category && <Chip label={match.referralMember.category} />}
                          <Chip label={match.scorePercent} color="primary" />
                        </Stack>
                        {match.referralMember?.businessName && <Typography color="text.secondary">{match.referralMember.businessName}</Typography>}
                        <Typography><strong>Why:</strong> {match.reason || 'No reason stored by the model.'}</Typography>
                        {match.suggestedIntro && <Typography><strong>Suggested intro:</strong> {match.suggestedIntro}</Typography>}
                        {match.referralMember?.keywords && <Typography color="text.secondary"><strong>Keywords:</strong> {match.referralMember.keywords}</Typography>}
                        {match.referralMember?.servicesOffered && <Typography color="text.secondary"><strong>Services:</strong> {match.referralMember.servicesOffered}</Typography>}
                        {match.referralMember?.idealReferral && <Typography color="text.secondary"><strong>Ideal referral:</strong> {match.referralMember.idealReferral}</Typography>}
                        {match.referralMember?.negativeKeywords && <Typography color="text.secondary"><strong>Negative keywords:</strong> {match.referralMember.negativeKeywords}</Typography>}
                      </Stack>
                    </CardContent>
                  </Card>
                )) : <Typography color="text.secondary">No member matches were saved for this assessment.</Typography>}
              </Stack>
            </Stack>
          )}

          {tab === 'raw' && (
            <Stack spacing={2}>
              <Tabs value={rawTab} onChange={(_, value) => setRawTab(value)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tab value="prompt" label="Prompt" />
                <Tab value="input" label="Input" />
                <Tab value="output" label="Output" />
              </Tabs>

              {rawTab === 'prompt' && (
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="h6">System Prompt</Typography>
                    <Typography color="text.secondary" sx={{ mb: 1 }}>Main instruction prompt from Settings.</Typography>
                    {codePanel(assessment.promptText || 'No system prompt stored.')}
                  </Box>
                  <Box>
                    <Typography variant="h6">Rendered Request</Typography>
                    <Typography color="text.secondary" sx={{ mb: 1 }}>Exact system instructions used for this single-call assessment.</Typography>
                    {codePanel(assessment.renderedPrompt || assessment.promptText || 'No rendered prompt stored.')}
                  </Box>
                </Stack>
              )}

              {rawTab === 'input' && (
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="h6">Structured Input Payload</Typography>
                    <Typography color="text.secondary" sx={{ mb: 1 }}>Post and all active referral-member profiles sent to the model. Member matches must use exact IDs from this list.</Typography>
                    {codePanel(assessment.inputPayload)}
                  </Box>
                </Stack>
              )}

              {rawTab === 'output' && (
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="h6">Parsed JSON</Typography>
                    {codePanel(assessment.parsed)}
                  </Box>
                  <Box>
                    <Typography variant="h6">Raw Model Response</Typography>
                    {codePanel(assessment.rawResponse)}
                  </Box>
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
