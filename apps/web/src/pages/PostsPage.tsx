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
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
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
}

interface GroupOption {
  id: string;
  friendlyName: string;
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

export function PostsPage() {
  const [posts, setPosts] = useState<PostWithGroup[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<PostListResponse['counts']>();
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [rawPost, setRawPost] = useState<Record<string, unknown>>();

  const rawJson = useMemo(() => rawPost ? JSON.stringify(rawPost, null, 2) : '', [rawPost]);

  const load = () => {
    const params = new URLSearchParams({ reviewStatus: reviewFilter, groupId: groupFilter });
    if (confidenceFilter !== 'all') params.set('minConfidence', confidenceFilter);
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
  }, []);

  useEffect(() => {
    void load();
  }, [reviewFilter, groupFilter, confidenceFilter]);

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

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h4">Collected Posts</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button onClick={() => void load()}>Refresh</Button>
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
                  <Chip size="small" label={post.analysisStatus} />
                  {post.originalTimestampLabel && <Chip size="small" label={post.originalTimestampLabel} />}
                  <Chip size="small" label={post.hasImages ? `${post.imageCount} image(s)` : 'No images'} />
                  {typeof post.extractionConfidence === 'number' && <Chip size="small" label={`Confidence ${Math.round(post.extractionConfidence * 100)}%`} />}
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button size="small" disabled={Boolean(busy)} onClick={() => void openRawData(post)}>
                    {busy === `${post.id}:raw` ? 'Loading...' : 'Raw Data'}
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
              <Typography color="text.secondary">{post.canonicalPostUrl}</Typography>
              <Typography color="text.secondary">
                Posted {post.originalPostedAt ? new Date(post.originalPostedAt).toLocaleString() : 'Unknown'} · Discovered {new Date(post.firstDiscoveredAt).toLocaleString()}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      ))}

      <Dialog open={Boolean(rawPost)} onClose={() => setRawPost(undefined)} maxWidth="md" fullWidth>
        <DialogTitle>Post Raw Data</DialogTitle>
        <DialogContent dividers>
          {rawPost && (
            <Stack spacing={2}>
              <RawPostData data={rawPost} />
              <Divider />
              <Typography variant="h6">Full JSON</Typography>
              <Box component="pre" sx={{ bgcolor: 'grey.100', borderRadius: 1, fontSize: 12, overflow: 'auto', p: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {rawJson}
              </Box>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
