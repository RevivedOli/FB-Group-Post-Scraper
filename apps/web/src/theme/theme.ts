import { createTheme } from '@mui/material/styles';

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#3157d5', dark: '#243a95', light: '#e6ebff' },
    secondary: { main: '#0f766e' },
    success: { main: '#2f855a' },
    warning: { main: '#b7791f' },
    error: { main: '#c53030' },
    background: { default: '#f6f7fb', paper: '#ffffff' },
    text: { primary: '#172033', secondary: '#687086' },
    divider: 'rgba(26, 32, 44, 0.08)',
  },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h4: { fontWeight: 760, letterSpacing: 0 },
    h5: { fontWeight: 720, letterSpacing: 0 },
    h6: { fontWeight: 700, letterSpacing: 0 },
    button: { fontWeight: 700, textTransform: 'none', letterSpacing: 0 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#f6f7fb',
        },
        '*': {
          boxSizing: 'border-box',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid rgba(26, 32, 44, 0.08)',
          boxShadow: '0 10px 28px rgba(31, 41, 55, 0.06)',
          transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 8, boxShadow: 'none' },
        contained: { boxShadow: '0 8px 18px rgba(49, 87, 213, 0.22)' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 650 },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#ffffff',
          borderRadius: 8,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 14,
        },
      },
    },
  },
});
