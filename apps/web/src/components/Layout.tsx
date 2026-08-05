import { Box, List, ListItemButton, ListItemText, Typography } from '@mui/material';

const nav = ['Dashboard', 'Posts', 'Groups', 'Referral Directory', 'AI Queue', 'Settings'];

export function Layout({ page, setPage, children }: { page: string; setPage: (p: string) => void; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="aside"
        sx={{
          bgcolor: '#101828',
          color: 'white',
          flexShrink: 0,
          minHeight: '100vh',
          p: 2,
          position: 'sticky',
          top: 0,
          width: 260,
        }}
      >
        <Box sx={{ mb: 3, px: 1, py: 1.5 }}>
          <Typography variant="h6">Local Group Monitor</Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.62)' }}>Referral intelligence</Typography>
        </Box>
        <List sx={{ display: 'grid', gap: 0.5 }}>
          {nav.map((item) => (
            <ListItemButton
              key={item}
              selected={page === item}
              onClick={() => setPage(item)}
              sx={{
                borderRadius: 2,
                color: page === item ? '#101828' : 'rgba(255,255,255,0.78)',
                '&.Mui-selected': { bgcolor: '#ffffff', color: '#101828' },
                '&.Mui-selected:hover': { bgcolor: '#ffffff' },
                '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
              }}
            >
              <ListItemText primary={item} primaryTypographyProps={{ fontWeight: page === item ? 760 : 650 }} />
            </ListItemButton>
          ))}
        </List>
      </Box>
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 4 } }}>
        <Box sx={{ animation: 'fadeIn 180ms ease', '@keyframes fadeIn': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'translateY(0)' } } }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
