import { useEffect, useState } from 'react';
import type { PostListResponse } from '@local-group-monitor/shared';
import { Alert, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
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

export function PostsPage(){
const [posts,setPosts]=useState<PostWithGroup[]>([]); const [total,setTotal]=useState(0); const [busy,setBusy]=useState<string>(); const [message,setMessage]=useState<string>(); const [error,setError]=useState<string>();
const load=()=>apiGet<PostListResponse>('/posts').then(result=>{setPosts(result.items as PostWithGroup[]); setTotal(result.total);}).catch(err=>setError(err instanceof Error ? err.message : String(err)));
useEffect(()=>{void load();},[]);
async function removePost(post:PostWithGroup){if(!window.confirm('Delete this collected post from the local database?')) return; setBusy(post.id); setMessage(undefined); setError(undefined); try{await apiSend(`/posts/${post.id}`,'DELETE'); setMessage('Post deleted.'); await load();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
return <Stack spacing={3}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h4">Collected Posts</Typography><Button onClick={()=>void load()}>Refresh</Button></Stack>{message&&<Alert severity="success">{message}</Alert>}{error&&<Alert severity="error">{error}</Alert>}<Typography color="text.secondary">{total} post(s) collected locally.</Typography>{posts.length===0?<Card><CardContent><Typography color="text.secondary">No posts collected yet. Run a group from the Dashboard or Groups page.</Typography></CardContent></Card>:posts.map(post=><Card key={post.id}><CardContent><Stack spacing={1.5}><Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Chip size="small" label={post.group?.friendlyName ?? 'Group'}/>{post.authorName&&<Chip size="small" label={post.authorName}/>}<Chip size="small" label={post.reviewStatus}/><Chip size="small" label={post.analysisStatus}/>{post.originalTimestampLabel&&<Chip size="small" label={post.originalTimestampLabel}/>}<Chip size="small" label={post.hasImages?`${post.imageCount} image(s)`:'No images'}/>{typeof post.extractionConfidence==='number'&&<Chip size="small" label={`Confidence ${Math.round(post.extractionConfidence*100)}%`}/>}</Stack><Button size="small" color="error" disabled={busy===post.id} onClick={()=>void removePost(post)}>{busy===post.id?'Deleting...':'Delete'}</Button></Stack><Typography>{post.latestCapturedText || 'No text captured.'}</Typography><Typography color="text.secondary">{post.canonicalPostUrl}</Typography><Typography color="text.secondary">Posted {post.originalPostedAt ? new Date(post.originalPostedAt).toLocaleString() : 'Unknown'} · Discovered {new Date(post.firstDiscoveredAt).toLocaleString()}</Typography></Stack></CardContent></Card>)}</Stack>}
