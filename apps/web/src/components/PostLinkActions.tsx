import { useState, type MouseEvent } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { apiSend } from '../api/client';

export interface PostLinkFields {
  id: string;
  canonicalPostUrl: string;
  hasRealPermalink?: boolean;
  searchPostUrl?: string | null;
  openPostUrl?: string;
  searchExcerpt?: string | null;
}

interface PostLinkActionsProps {
  post: PostLinkFields;
  showStoredUrl?: boolean;
  /** Footer cards already show a "No direct URL" status chip — hide the duplicate here. */
  variant?: 'default' | 'footer';
  onUpdated?: (post: PostLinkFields) => void;
  stopPropagation?: boolean;
}

export function PostLinkActions({
  post,
  showStoredUrl = true,
  variant = 'default',
  onUpdated,
  stopPropagation = false,
}: PostLinkActionsProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [hasConflict, setHasConflict] = useState(false);

  const hasReal = Boolean(post.hasRealPermalink);
  const openUrl = post.openPostUrl || post.searchPostUrl || post.canonicalPostUrl;

  function openDialog(event?: MouseEvent) {
    if (stopPropagation) event?.stopPropagation();
    setUrlDraft(hasReal ? post.canonicalPostUrl : '');
    setError(undefined);
    setHasConflict(false);
    setDialogOpen(true);
  }

  async function saveUrl() {
    setBusy(true);
    setError(undefined);
    setHasConflict(false);
    try {
      const updated = await apiSend<PostLinkFields>(`/posts/${post.id}/canonical-url`, 'PATCH', {
        canonicalPostUrl: urlDraft.trim(),
      });
      setDialogOpen(false);
      onUpdated?.(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setHasConflict(/another saved post/i.test(message));
    } finally {
      setBusy(false);
    }
  }

  const showWarningChip = variant !== 'footer' && !hasReal;

  return (
    <>
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          {showWarningChip && <Chip size="small" color="warning" label="No direct URL" />}
          <Button
            size="small"
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => { if (stopPropagation) event.stopPropagation(); }}
          >
            {hasReal ? 'Open Post' : 'Search Facebook'}
          </Button>
          <Button
            size="small"
            onClick={(event) => openDialog(event)}
          >
            {hasReal ? 'Edit URL' : 'Save direct URL'}
          </Button>
        </Stack>
        {showStoredUrl && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              wordBreak: 'break-all',
              ...(variant === 'footer'
                ? {
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }
                : {}),
            }}
          >
            {hasReal ? post.canonicalPostUrl : (post.searchPostUrl || post.canonicalPostUrl)}
            {!hasReal && post.searchExcerpt ? ` · query: “${post.searchExcerpt}”` : ''}
          </Typography>
        )}
      </Stack>

      <Dialog
        open={dialogOpen}
        onClose={() => !busy && setDialogOpen(false)}
        fullWidth
        maxWidth="sm"
        onClick={(event) => { if (stopPropagation) event.stopPropagation(); }}
      >
        <DialogTitle>{hasReal ? 'Update direct post URL' : 'Save direct Facebook post URL'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography color="text.secondary">
              Paste the real Facebook permalink from the group search result (…/groups/…/posts/…).
              This replaces the local fallback link so referrals can open the post directly.
            </Typography>
            {!hasReal && post.searchPostUrl && (
              <Button size="small" href={post.searchPostUrl} target="_blank" rel="noreferrer">
                Open Facebook search first
              </Button>
            )}
            <TextField
              label="Facebook post URL"
              value={urlDraft}
              onChange={(event) => setUrlDraft(event.target.value)}
              fullWidth
              autoFocus
              placeholder="https://www.facebook.com/groups/.../posts/..."
            />
            {error && (
              <Alert severity="error">
                {error}
                {hasConflict ? ' Open that existing post from Collected Posts instead of duplicating it.' : ''}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !urlDraft.trim()} onClick={() => void saveUrl()}>
            {busy ? 'Saving...' : 'Save URL'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
