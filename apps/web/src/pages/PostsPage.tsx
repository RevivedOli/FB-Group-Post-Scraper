import { useEffect, useMemo, useState } from 'react';
import type { PostDetailResponse, PostListResponse } from '@local-group-monitor/shared';
import { reviewStatuses } from '@local-group-monitor/shared';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { apiGet, apiSend } from '../api/client';

interface PostWithGroup {
  id: string;
  canonicalPostUrl: string;
  authorName?: string | null;
  latestCapturedText?: string | null;
  originalTimestampLabel?: string | null;
  originalPostedAt?: string | null;
  firstDiscoveredAt: string;
  reviewStatus: string;
  analysisStatus: string;
  hasImages: boolean;
  imageCount: number;
  extractionConfidence?: number | null;
  group?: { friendlyName: string };
  aiAssessments?: AiAssessment[];
}

interface GroupOption {
  id: string;
  friendlyName: string;
}

interface MemberOption {
  id: string;
  name: string;
  category: string;
}

interface AiAssessment {
  id: string;
  status: string;
  intent?: string | null;
  isReferralOpportunity?: boolean | null;
  confidence?: number | null;
  summary?: string | null;
  errorMessage?: string | null;
  memberMatches?: Array<{
    id: string;
    scorePercent: string;
    reason?: string | null;
    suggestedIntro?: string | null;
    referralMember?: { id: string; name: string; category: string; businessName?: string | null; facebookName?: string | null; facebookProfileUrl?: string | null };
  }>;
}

type ReviewFilter = 'all' | typeof reviewStatuses[number];
type ConfidenceFilter = 'all' | '0.45' | '0.8' | '0.9';

function formatValue(value: unknown) {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function RawPostData({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  return (
    <Stack spacing={1.5}>
      {entries.map(([key, value]) => {
        const isObject = value !== null && typeof value === 'object';
        return (
          <Box key={key}>
            <Typography variant="caption" color="text.secondary">{key}</Typography>
            <Box
              component="pre"
              sx={{
                bgcolor: 'grey.100',
                borderRadius: 1,
                fontSize: 12,
                m: 0,
                mt: 0.5,
                overflow: 'auto',
                p: 1,
                whiteSpace: isObject ? 'pre-wrap' : 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {formatValue(value)}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function formatAiRunMessage(result: Record<string, unknown>) {
  const reason = typeof result.reason === 'string' ? result.reason.replaceAll('_', ' ') : undefined;
  if (result.queued === true) return 'AI analysis queued and started.';
  if (reason) return `AI analysis not queued: ${reason}.`;
  return 'AI analysis request sent.';
}

export function PostsPage() {
  const [posts, setPosts] = useState<PostWithGroup[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<PostListResponse['counts']>();
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [aiReferralOnly, setAiReferralOnly] = useState(false);
  const [aiIntent, setAiIntent] = useState('all');
  const [aiMemberId, setAiMemberId] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [rawPost, setRawPost] = useState<Record<string, unknown>>();
  const [rerunOpen, setRerunOpen] = useState(false);
  const [rerunGroupId, setRerunGroupId] = useState('all');
  const [rerunReviewStatus, setRerunReviewStatus] = useState('all');
  const [rerunAnalysisScope, setRerunAnalysisScope] = useState('not_analysed');
  const [rerunDiscoveredDays, setRerunDiscoveredDays] = useState('7');
  const [rerunObservedDays, setRerunObservedDays] = useState('all');
  const [rerunLimit, setRerunLimit] = useState('300');
  const [rerunApplyPrefilter, setRerunApplyPrefilter] = useState(true);
  const [rerunSearch, setRerunSearch] = useState('');

  const rawJson = useMemo(() => rawPost ? JSON.stringify(rawPost, null, 2) : '', [rawPost]);

  const load = () => {
    const params = new URLSearchParams({ reviewStatus: reviewFilter, groupId: groupFilter });
    if (confidenceFilter !== 'all') params.set('minConfidence', confidenceFilter);
    if (aiReferralOnly) params.set('aiReferralOnly', 'true');
    if (aiIntent !== 'all') params.set('aiIntent', aiIntent);
    if (aiMemberId !== 'all') params.set('aiMemberId', aiMemberId);
    if (search.trim()) params.set('search', search.trim());
    return apiGet<PostListResponse>(`/posts?${params.toString()}`)
      .then((result) => {
        setPosts(result.items as PostWithGroup[]);
        setTotal(result.total);
        setCounts(result.counts);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    void apiGet<GroupOption[]>('/groups').then(setGroups).catch(() => setGroups([]));
    void apiGet<{ members: MemberOption[] }>('/referrals').then((result) => setMembers(result.members)).catch(() => setMembers([]));
  }, []);

  useEffect(() => {
    void load();
  }, [reviewFilter, groupFilter, confidenceFilter, aiReferralOnly, aiIntent, aiMemberId]);

  async function removePost(post: PostWithGroup) {
    if (!window.confirm('Delete this collected post from the local database?')) return;
    setBusy(post.id);
    setMessage(undefined);
    setError(undefined);
    try {
      await apiSend(`/posts/${post.id}`, 'DELETE');
      setMessage('Post deleted.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function updateReview(post: PostWithGroup, reviewStatus: typeof reviewStatuses[number]) {
    setBusy(`${post.id}:${reviewStatus}`);
    setMessage(undefined);
    setError(undefined);
    try {
      await apiSend(`/posts/${post.id}/review`, 'PATCH', { reviewStatus });
      setMessage(`Marked post as ${reviewStatus.replace('_', ' ')}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function deleteIgnored() {
    if (!window.confirm('Delete all posts marked ignored from the local database?')) return;
    setBusy('delete-ignored');
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await apiSend<{ count: number }>('/posts/ignored/all', 'DELETE');
      setMessage(`Deleted ${result.count} ignored post(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function openRawData(post: PostWithGroup) {
    setBusy(`${post.id}:raw`);
    setError(undefined);
    try {
      const result = await apiGet<PostDetailResponse>(`/posts/${post.id}`);
      setRawPost(result.post);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function runAi(post: PostWithGroup, force = false) {
    setBusy(`${post.id}:ai`);
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await apiSend<Record<string, unknown>>(`/ai/posts/${post.id}/run`, 'POST', {
        force,
        process: true,
        bypassPrefilter: force,
      });
      setMessage(formatAiRunMessage(result));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  function openRerunDialog() {
    setRerunGroupId(groupFilter);
    setRerunReviewStatus(reviewFilter);
    setRerunSearch(search);
    setRerunOpen(true);
  }

  async function runFilteredAiRerun() {
    setBusy('rerun-filtered');
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await apiSend<{
        inspected: number;
        queued: number;
        skipped: number;
        failed: number;
        applyPrefilter: boolean;
        reasons?: Record<string, number>;
      }>('/ai/rerun-filtered', 'POST', {
        groupId: rerunGroupId,
        reviewStatus: rerunReviewStatus,
        analysisScope: rerunAnalysisScope,
        discoveredWithinDays: rerunDiscoveredDays === 'all' ? undefined : Number(rerunDiscoveredDays),
        lastObservedWithinDays: rerunObservedDays === 'all' ? undefined : Number(rerunObservedDays),
        limit: Number(rerunLimit) || 300,
        applyPrefilter: rerunApplyPrefilter,
        search: rerunSearch.trim() || undefined,
        force: true,
        process: true,
      });
      const reasonSummary = result.reasons
        ? Object.entries(result.reasons).map(([reason, count]) => `${reason.replaceAll('_', ' ')}: ${count}`).join(', ')
        : '';
      setMessage(
        `AI rerun: inspected ${result.inspected}, queued ${result.queued}, skipped ${result.skipped}, failed ${result.failed}. `
        + `Pre-filter ${result.applyPrefilter ? 'applied' : 'bypassed'}.`
        + (reasonSummary ? ` (${reasonSummary})` : ''),
      );
      setRerunOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  const latestAiFromRaw = rawPost?.aiAssessments && Array.isArray(rawPost.aiAssessments) ? rawPost.aiAssessments[0] as AiAssessment | undefined : undefined;

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h4">Collected Posts</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button onClick={() => void load()}>Refresh</Button>
          <Button variant="contained" disabled={Boolean(busy)} onClick={openRerunDialog}>
            Rerun AI
          </Button>
          <Button color="error" disabled={busy === 'delete-ignored' || !counts?.ignored} onClick={() => void deleteIgnored()}>
            {busy === 'delete-ignored' ? 'Deleting...' : 'Delete Ignored'}
          </Button>
        </Stack>
      </Stack>

      {message && <Alert severity="success">{message}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
            <TextField select size="small" label="Review" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as ReviewFilter)} sx={{ width: 180 }}>
              <MenuItem value="all">All ({counts?.all ?? 0})</MenuItem>
              {reviewStatuses.map((status) => <MenuItem key={status} value={status}>{status.replace('_', ' ')} ({counts?.[status] ?? 0})</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Group" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} sx={{ minWidth: 240 }}>
              <MenuItem value="all">All groups</MenuItem>
              {groups.map((group) => <MenuItem key={group.id} value={group.id}>{group.friendlyName}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Confidence" value={confidenceFilter} onChange={(event) => setConfidenceFilter(event.target.value as ConfidenceFilter)} sx={{ width: 180 }}>
              <MenuItem value="all">All confidence</MenuItem>
              <MenuItem value="0.45">45%+</MenuItem>
              <MenuItem value="0.8">80%+</MenuItem>
              <MenuItem value="0.9">90%+</MenuItem>
            </TextField>
            <TextField select size="small" label="AI intent" value={aiIntent} onChange={(event) => setAiIntent(event.target.value)} sx={{ width: 190 }}>
              <MenuItem value="all">All AI intents</MenuItem>
              <MenuItem value="looking_for_help">Looking for help</MenuItem>
              <MenuItem value="advertising">Advertising</MenuItem>
              <MenuItem value="discussion">Discussion</MenuItem>
              <MenuItem value="irrelevant">Irrelevant</MenuItem>
            </TextField>
            <TextField select size="small" label="Matched member" value={aiMemberId} onChange={(event) => setAiMemberId(event.target.value)} sx={{ minWidth: 220 }}>
              <MenuItem value="all">Any member</MenuItem>
              {members.map((member) => <MenuItem key={member.id} value={member.id}>{member.name} · {member.category}</MenuItem>)}
            </TextField>
            <FormControlLabel control={<Switch checked={aiReferralOnly} onChange={(event) => setAiReferralOnly(event.target.checked)} />} label="AI referrals only" />
            <TextField size="small" label="Search" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} sx={{ minWidth: 260 }} />
            <Button variant="contained" onClick={() => void load()}>Search</Button>
          </Stack>
        </CardContent>
      </Card>

      <Typography color="text.secondary">{total} post(s) in this view.</Typography>

      {posts.length === 0 ? (
        <Card><CardContent><Typography color="text.secondary">No posts match this view.</Typography></CardContent></Card>
      ) : posts.map((post) => (
        <Card key={post.id}>
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={post.group?.friendlyName ?? 'Group'} />
                  {post.authorName && <Chip size="small" label={post.authorName} />}
                  <Chip size="small" label={post.reviewStatus} color={post.reviewStatus === 'useful' ? 'success' : post.reviewStatus === 'ignored' ? 'default' : post.reviewStatus === 'requires_review' ? 'warning' : 'primary'} />
                  {!post.aiAssessments?.[0] && <Chip size="small" label={post.analysisStatus} />}
                  {post.aiAssessments?.[0] && (
                    <Chip
                      size="small"
                      label={`AI: ${post.aiAssessments[0].status === 'completed' ? post.aiAssessments[0].intent ?? 'done' : post.aiAssessments[0].status}`}
                      color={post.aiAssessments[0].isReferralOpportunity ? 'success' : post.aiAssessments[0].status === 'failed' ? 'error' : 'default'}
                    />
                  )}
                  {post.originalTimestampLabel && <Chip size="small" label={post.originalTimestampLabel} />}
                  <Chip size="small" label={post.hasImages ? `${post.imageCount} image(s)` : 'No images'} />
                  {typeof post.extractionConfidence === 'number' && <Chip size="small" label={`Confidence ${Math.round(post.extractionConfidence * 100)}%`} />}
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button size="small" disabled={Boolean(busy)} onClick={() => void openRawData(post)}>
                    {busy === `${post.id}:raw` ? 'Loading...' : 'Raw Data'}
                  </Button>
                  <Button size="small" disabled={Boolean(busy)} onClick={() => void runAi(post, Boolean(post.aiAssessments?.length))}>
                    {busy === `${post.id}:ai` ? 'Running...' : post.aiAssessments?.length ? 'Rerun AI' : 'Run AI'}
                  </Button>
                  <Button size="small" disabled={Boolean(busy)} onClick={() => void updateReview(post, 'useful')}>Useful</Button>
                  <Button size="small" color="warning" disabled={Boolean(busy)} onClick={() => void updateReview(post, 'requires_review')}>Review</Button>
                  <Button size="small" color="inherit" disabled={Boolean(busy)} onClick={() => void updateReview(post, 'ignored')}>Ignore</Button>
                  <Button size="small" color="error" disabled={busy === post.id} onClick={() => void removePost(post)}>
                    {busy === post.id ? 'Deleting...' : 'Delete'}
                  </Button>
                </Stack>
              </Stack>
              <Typography>{post.latestCapturedText || 'No text captured.'}</Typography>
              {post.aiAssessments?.[0]?.summary && <Typography color="text.secondary">AI: {post.aiAssessments[0].summary}</Typography>}
              {post.aiAssessments?.[0]?.memberMatches && post.aiAssessments[0].memberMatches.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {post.aiAssessments[0].memberMatches.map((match) => (
                    <Chip key={match.id} size="small" label={`${match.referralMember?.name ?? 'Member'} ${match.scorePercent}`} />
                  ))}
                </Stack>
              )}
              <Link href={post.canonicalPostUrl} target="_blank" color="text.secondary" underline="hover">{post.canonicalPostUrl}</Link>
              <Typography color="text.secondary">
                Posted {post.originalPostedAt ? new Date(post.originalPostedAt).toLocaleString() : 'Unknown'} · Discovered {new Date(post.firstDiscoveredAt).toLocaleString()}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      ))}

      <Dialog open={Boolean(rawPost)} onClose={() => setRawPost(undefined)} maxWidth="md" fullWidth>
        <DialogTitle>Post Details</DialogTitle>
        <DialogContent dividers>
          {rawPost && (
            <Stack spacing={2}>
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={1.25}>
                    <Typography variant="h6">Captured Post</Typography>
                    <Typography>{String(rawPost.latestCapturedText ?? 'No text captured.')}</Typography>
                    {typeof rawPost.canonicalPostUrl === 'string' && (
                      <Link href={rawPost.canonicalPostUrl} target="_blank" underline="hover">{rawPost.canonicalPostUrl}</Link>
                    )}
                    <Typography color="text.secondary">
                      {String(rawPost.authorName ?? 'Unknown author')} · {typeof rawPost.firstDiscoveredAt === 'string' ? new Date(rawPost.firstDiscoveredAt).toLocaleString() : 'Unknown date'}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
              {latestAiFromRaw && (
                <Card variant="outlined">
                  <CardContent>
                    <Stack spacing={1.25}>
                      <Typography variant="h6">Latest AI Assessment</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={latestAiFromRaw.status} />
                        {latestAiFromRaw.intent && <Chip size="small" label={latestAiFromRaw.intent} />}
                        {typeof latestAiFromRaw.confidence === 'number' && <Chip size="small" label={`${Math.round(latestAiFromRaw.confidence * 100)}% confidence`} />}
                      </Stack>
                      {latestAiFromRaw.summary && <Typography>{latestAiFromRaw.summary}</Typography>}
                      {latestAiFromRaw.errorMessage && <Alert severity="error">{latestAiFromRaw.errorMessage}</Alert>}
                      {latestAiFromRaw.memberMatches && latestAiFromRaw.memberMatches.length > 0 && latestAiFromRaw.memberMatches.map((match) => (
                        <Card key={match.id} variant="outlined">
                          <CardContent>
                            <Stack spacing={0.75}>
                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Chip size="small" label={match.referralMember?.name ?? 'Member'} />
                                <Chip size="small" label={match.referralMember?.category ?? 'Category'} />
                                <Chip size="small" label={match.scorePercent} />
                              </Stack>
                              {match.reason && <Typography>{match.reason}</Typography>}
                              {match.suggestedIntro && <Typography color="text.secondary">{match.suggestedIntro}</Typography>}
                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                {match.referralMember?.facebookName && <Button size="small" onClick={() => void copyText(match.referralMember?.facebookName ?? '')}>Copy FB Name</Button>}
                                {match.referralMember?.facebookProfileUrl && <Button size="small" href={match.referralMember.facebookProfileUrl} target="_blank">Open Profile</Button>}
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              )}
              <Accordion>
                <AccordionSummary>Advanced raw data</AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <RawPostData data={rawPost} />
                    <Typography variant="h6">Full JSON</Typography>
                    <Box component="pre" sx={{ bgcolor: 'grey.100', borderRadius: 1, fontSize: 12, overflow: 'auto', p: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {rawJson}
                    </Box>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Stack>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rerunOpen} onClose={() => setRerunOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Rerun AI on posts</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography color="text.secondary">
              Queue a filtered set of posts for AI analysis. Skipped posts still appear in the Referral Queue when the pre-filter rejects them.
            </Typography>
            <TextField select size="small" label="Group" value={rerunGroupId} onChange={(event) => setRerunGroupId(event.target.value)}>
              <MenuItem value="all">All groups</MenuItem>
              {groups.map((group) => <MenuItem key={group.id} value={group.id}>{group.friendlyName}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Review status" value={rerunReviewStatus} onChange={(event) => setRerunReviewStatus(event.target.value)}>
              <MenuItem value="all">All review statuses</MenuItem>
              {reviewStatuses.map((status) => <MenuItem key={status} value={status}>{status.replace('_', ' ')}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="Analysis scope" value={rerunAnalysisScope} onChange={(event) => setRerunAnalysisScope(event.target.value)}>
              <MenuItem value="not_analysed">Not analysed yet</MenuItem>
              <MenuItem value="all">All posts in filter</MenuItem>
              <MenuItem value="previously_analysed">Previously analysed</MenuItem>
              <MenuItem value="skipped_prefilter">Previously skipped by pre-filter</MenuItem>
              <MenuItem value="failed">Previously failed</MenuItem>
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField select size="small" label="Discovered within" value={rerunDiscoveredDays} onChange={(event) => setRerunDiscoveredDays(event.target.value)} fullWidth>
                <MenuItem value="1">Last 1 day</MenuItem>
                <MenuItem value="3">Last 3 days</MenuItem>
                <MenuItem value="7">Last 7 days</MenuItem>
                <MenuItem value="14">Last 14 days</MenuItem>
                <MenuItem value="30">Last 30 days</MenuItem>
                <MenuItem value="all">Any time</MenuItem>
              </TextField>
              <TextField select size="small" label="Last scraped within" value={rerunObservedDays} onChange={(event) => setRerunObservedDays(event.target.value)} fullWidth>
                <MenuItem value="1">Last 1 day</MenuItem>
                <MenuItem value="3">Last 3 days</MenuItem>
                <MenuItem value="7">Last 7 days</MenuItem>
                <MenuItem value="14">Last 14 days</MenuItem>
                <MenuItem value="30">Last 30 days</MenuItem>
                <MenuItem value="all">Any time</MenuItem>
              </TextField>
            </Stack>
            <TextField size="small" label="Max posts" type="number" value={rerunLimit} onChange={(event) => setRerunLimit(event.target.value)} helperText="Safety cap for one rerun batch" />
            <TextField size="small" label="Search text (optional)" value={rerunSearch} onChange={(event) => setRerunSearch(event.target.value)} />
            <FormControlLabel
              control={<Switch checked={rerunApplyPrefilter} onChange={(event) => setRerunApplyPrefilter(event.target.checked)} />}
              label="Use pre-filter trigger phrases"
            />
            <Typography variant="body2" color="text.secondary">
              {rerunApplyPrefilter
                ? 'Posts must match a Settings pre-filter phrase or they will be recorded as skipped (no LLM call).'
                : 'Pre-filter is bypassed. Every selected eligible post will be sent to the active AI provider.'}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRerunOpen(false)} disabled={busy === 'rerun-filtered'}>Cancel</Button>
          <Button variant="contained" onClick={() => void runFilteredAiRerun()} disabled={busy === 'rerun-filtered'}>
            {busy === 'rerun-filtered' ? 'Queueing...' : 'Queue AI rerun'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
