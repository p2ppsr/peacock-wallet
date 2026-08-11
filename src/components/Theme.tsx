import { useContext, useMemo, useEffect, useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  PaletteMode,
  StyledEngineProvider,
  useMediaQuery,
} from '@mui/material';
import { WalletContext } from '../WalletContext';

/* --------------------------------------------------------------------
 *                         Theme Type Augmentation
 * ------------------------------------------------------------------ */
declare module '@mui/material/styles' {
  interface Theme {
    templates: {
      page_wrap: {
        maxWidth: string;
        margin: string;
        boxSizing: string;
        padding: string | number;
      };
      subheading: {
        textTransform: string;
        letterSpacing: string;
        fontWeight: string;
      };
      boxOfChips: {
        display: string;
        justifyContent: string;
        flexWrap: string;
        gap: string | number;
      };
      chip: (props: { size: number; backgroundColor?: string }) => {
        height: string | number;
        minHeight: string | number;
        backgroundColor: string;
        borderRadius: string;
        padding: string | number;
        margin: string | number;
      };
      chipLabel: CSSProperties;
      chipLabelTitle: (props: { size: number }) => {
        fontSize: string | number;
        fontWeight: string;
      };
      chipLabelSubtitle: {
        fontSize: string;
        opacity: number;
      };
      chipContainer: {
        position: string;
        display: string;
        alignItems: string;
      };
    };
  }

  interface ThemeOptions {
    templates?: {
      page_wrap?: {
        maxWidth?: string;
        margin?: string;
        boxSizing?: string;
        padding?: string | number;
      };
      subheading?: {
        textTransform?: string;
        letterSpacing?: string;
        fontWeight?: string;
      };
      boxOfChips?: {
        display?: string;
        justifyContent?: string;
        flexWrap?: string;
        gap?: string | number;
      };
      chip?: (props: { size: number; backgroundColor?: string }) => {
        height?: string | number;
        minHeight?: string | number;
        backgroundColor?: string;
        borderRadius?: string;
        padding?: string | number;
        margin?: string | number;
      };
      chipLabel?: CSSProperties;
      chipLabelTitle?: (props: { size: number }) => {
        fontSize?: string | number;
        fontWeight?: string;
      };
      chipLabelSubtitle?: {
        fontSize?: string;
        opacity?: number;
      };
      chipContainer?: {
        position?: string;
        display?: string;
        alignItems?: string;
      };
    };
  }
}

/* --------------------------------------------------------------------
 *                                Props
 * ------------------------------------------------------------------ */
interface ThemeProps {
  children: ReactNode;
}

/* --------------------------------------------------------------------
 *                         AppThemeProvider
 * ------------------------------------------------------------------ */
export function AppThemeProvider({ children }: ThemeProps) {
  const { settings } = useContext(WalletContext);

  /* Detect OS-level colour-scheme preference */
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');

  // Track localStorage updates to trigger theme re-calculation
  const [localStorageVersion, setLocalStorageVersion] = useState(0);

  /* Decide the palette mode that should be in force */
  const mode: PaletteMode = useMemo(() => {
    // Always check localStorage first, then fall back to WalletContext settings
    let pref = settings?.theme?.mode ?? 'system';

    try {
      const cachedTheme = localStorage.getItem('userTheme');
      if (cachedTheme && ['light', 'dark', 'system'].includes(cachedTheme)) {
        pref = cachedTheme;
      } else {
        // Update localStorage with the WalletContext value
        if (pref) {
          localStorage.setItem('userTheme', pref);
        }
      }
    } catch (error) {
      console.warn('Failed to access localStorage:', error);
    }

    if (pref === 'system') {
      return prefersDarkMode ? 'dark' : 'light';
    }
    return pref as PaletteMode; // 'light' or 'dark'
  }, [settings?.theme?.mode, prefersDarkMode, localStorageVersion]);

  // Update localStorage only when WalletContext settings actually change (not on every render)
  const [lastWalletTheme, setLastWalletTheme] = useState<string | undefined>(settings?.theme?.mode);

  useEffect(() => {
    // Only update localStorage if WalletContext theme actually changed from what we last saw
    const currentWalletTheme = settings?.theme?.mode;

    if (currentWalletTheme && currentWalletTheme !== lastWalletTheme) {
      try {
        localStorage.setItem('userTheme', currentWalletTheme);
        // Trigger useMemo to re-run by updating the version
        setLocalStorageVersion(prev => prev + 1);
      } catch (error) {
        console.warn('Failed to update localStorage:', error);
      }

      setLastWalletTheme(currentWalletTheme);
    } else if (!lastWalletTheme && currentWalletTheme) {
      // First time WalletContext loads
      setLastWalletTheme(currentWalletTheme);
    }
  }, [settings?.theme?.mode, lastWalletTheme]);

  /* Re-compute the theme whenever `mode` flips */
  const theme = useMemo(() => {
    const isLight = mode === 'light';

    const paletteBase = isLight
      ? {
        primary: { main: '#086F68', contrastText: '#FFFFFF' },
        secondary: { main: '#356FA3', contrastText: '#FFFFFF' },
        warning: { main: '#B97805', contrastText: '#FFFFFF' },
        background: { default: '#F3F6F8', paper: '#FFFFFF' },
        text: { primary: '#10202B', secondary: '#526371' },
      }
      : {
        primary: { main: '#63E6D0', contrastText: '#041312' },
        secondary: { main: '#79B8EE', contrastText: '#07131C' },
        warning: { main: '#F3BD5B', contrastText: '#161004' },
        background: { default: '#071019', paper: '#101C27' },
        text: { primary: '#F2F7FA', secondary: '#A9BAC6' },
      };

    const atmosphere = isLight
      ? 'radial-gradient(circle at 10% 10%, rgba(8,111,104,0.11), transparent 34%), radial-gradient(circle at 88% 12%, rgba(53,111,163,0.1), transparent 30%)'
      : 'radial-gradient(circle at 12% 10%, rgba(99,230,208,0.1), transparent 32%), radial-gradient(circle at 88% 12%, rgba(121,184,238,0.1), transparent 30%)';

    const surfaceGradient = isLight
      ? 'linear-gradient(160deg, #FFFFFF, #F8FAFB)'
      : 'linear-gradient(160deg, #101C27, #0D1822)';

    return createTheme({
      approvals: {
        protocol: '#5DE2C2',
        basket: '#8CD87E',
        identity: '#67B7FF',
        renewal: '#C0A3FF',
      },
      palette: {
        mode,
        ...paletteBase,
      },
      typography: {
        fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        h1: {
          fontWeight: 700,
          fontSize: '2.7rem',
          letterSpacing: '-0.04em',
          '@media (max-width:900px)': { fontSize: '2rem' },
        },
        h2: {
          fontWeight: 600,
          fontSize: '1.95rem',
          letterSpacing: '-0.02em',
          '@media (max-width:900px)': { fontSize: '1.6rem' },
        },
        h3: { fontSize: '1.6rem', fontWeight: 600 },
        h4: { fontSize: '1.3rem', fontWeight: 600 },
        h5: { fontSize: '1.1rem', fontWeight: 600 },
        h6: { fontSize: '1rem', fontWeight: 500 },
        body1: { fontSize: '1rem', lineHeight: 1.5 },
        body2: { fontSize: '0.95rem', lineHeight: 1.5 },
        button: {
          fontWeight: 600,
          letterSpacing: '0.02em',
        },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              backgroundColor: paletteBase.background.default,
              backgroundImage: `${atmosphere}, linear-gradient(180deg, ${paletteBase.background.default}, ${isLight ? '#E6EBF1' : '#050A12'})`,
              backgroundAttachment: 'fixed',
              minHeight: '100vh',
              color: paletteBase.text.primary,
            },
            '#root': {
              minHeight: '100vh',
            },
            '::selection': {
              backgroundColor: `${paletteBase.primary.main}33`,
              color: paletteBase.text.primary,
            },
            ':focus-visible': {
              outline: `3px solid ${paletteBase.primary.main}`,
              outlineOffset: '3px',
            },
            '@media (prefers-reduced-motion: reduce)': {
              '*, *::before, *::after': {
                animationDuration: '0.01ms !important',
                animationIterationCount: '1 !important',
                scrollBehavior: 'auto !important',
                transitionDuration: '0.01ms !important',
              },
            },
          },
        },
        MuiButton: {
          styleOverrides: {
            root: {
              textTransform: 'none',
              borderRadius: 12,
              paddingInline: '1.45rem',
              paddingBlock: '0.7rem',
              transition: 'transform 180ms ease, box-shadow 180ms ease, background 200ms ease',
              fontWeight: 600,
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: isLight
                  ? '0 12px 28px rgba(14, 138, 114, 0.28)'
                  : '0 14px 32px rgba(0,0,0,0.6)',
              },
              '&.MuiButton-contained': {
                backgroundImage: isLight
                  ? 'linear-gradient(120deg, #086F68, #356FA3)'
                  : 'linear-gradient(120deg, #49CDB7, #659FD0)',
                color: '#FFFFFF',
                boxShadow: isLight
                  ? '0 10px 24px rgba(14,138,114,0.25)'
                  : '0 10px 26px rgba(0,0,0,0.55)',
                '&.MuiButton-containedWarning': {
                  backgroundImage: isLight
                    ? 'linear-gradient(120deg, #E6B230, #FF8A3D)'
                    : 'linear-gradient(120deg, #F2C562, #FF9B73)',
                  color: '#FFFFFF',
                  boxShadow: isLight
                    ? '0 10px 24px rgba(230,178,48,0.28)'
                    : '0 10px 26px rgba(242,197,98,0.35)',
                },
              },
              '&.MuiButton-outlined': {
                borderWidth: 2,
                borderColor: `${paletteBase.primary.main}70`,
                color: paletteBase.primary.main,
                backgroundColor: isLight ? 'rgba(14,138,114,0.08)' : 'rgba(93,226,194,0.12)',
              },
              '&.MuiButton-text': {
                color: isLight ? paletteBase.secondary.main : paletteBase.primary.main,
              },
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              backgroundImage: surfaceGradient,
              borderRadius: 16,
              boxShadow: isLight
                ? '0 12px 30px rgba(16, 32, 43, 0.08)'
                : '0 16px 34px rgba(0,0,0,0.34)',
              border: `1px solid ${isLight ? 'rgba(14,138,114,0.18)' : 'rgba(255,255,255,0.08)'}`,
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              borderRadius: 16,
              border: `1px solid ${isLight ? 'rgba(14,138,114,0.16)' : 'rgba(255,255,255,0.1)'}`,
              backgroundImage: surfaceGradient,
            },
          },
        },
        MuiAppBar: {
          styleOverrides: {
            root: {
              borderRadius: 14,
              margin: '16px',
              backgroundImage: isLight
                ? 'linear-gradient(120deg, #0F1624, #0E8A72)'
                : 'linear-gradient(120deg, #060B15, #1C2B3E)',
              color: '#FFFFFF',
              boxShadow: '0 18px 40px rgba(0,0,0,0.2)',
            },
          },
        },
        MuiChip: {
          styleOverrides: {
            root: {
              borderRadius: 999,
              backgroundColor: isLight ? 'rgba(14,138,114,0.08)' : 'rgba(93,226,194,0.16)',
              color: paletteBase.text.primary,
            },
          },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              borderRadius: 12,
              backgroundColor: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(5,8,23,0.7)',
              '& fieldset': {
                borderColor: isLight ? 'rgba(14,138,114,0.25)' : 'rgba(93,226,194,0.25)',
              },
              '&:hover fieldset': {
                borderColor: paletteBase.primary.main,
              },
              '&.Mui-focused fieldset': {
                borderWidth: 2,
                borderColor: paletteBase.secondary.main,
                boxShadow: `0 0 0 4px ${isLight ? 'rgba(255,138,61,0.14)' : 'rgba(255,155,115,0.2)'}`,
              },
            },
            input: {
              padding: '14px 16px',
            },
          },
        },
        MuiInputLabel: {
          styleOverrides: {
            root: {
              fontWeight: 500,
              color: `${paletteBase.text.secondary}`,
            },
          },
        },
        MuiStepLabel: {
          styleOverrides: {
            labelContainer: {
              '& .MuiTypography-root': {
                color: paletteBase.text.secondary,
                fontWeight: 500,
              },
            },
            iconContainer: {
              '& svg': {
                color: paletteBase.secondary.main,
              },
            },
          },
        },
        MuiDialog: {
          styleOverrides: {
            paper: {
              borderRadius: 18,
              backgroundImage: surfaceGradient,
              border: `1px solid ${isLight ? 'rgba(14,138,114,0.14)' : 'rgba(255,255,255,0.12)'}`,
              boxShadow: isLight
                ? '0 32px 60px rgba(15,22,36,0.18)'
                : '0 42px 72px rgba(0,0,0,0.75)',
            },
          },
        },
        MuiDialogTitle: {
          styleOverrides: {
            root: {
              fontWeight: 700,
              borderBottom: `1px solid ${isLight ? 'rgba(17,17,26,0.08)' : 'rgba(255,255,255,0.08)'}`,
            },
          },
        },
        MuiDialogActions: {
          styleOverrides: {
            root: {
              borderTop: `1px solid ${isLight ? 'rgba(17,17,26,0.08)' : 'rgba(255,255,255,0.08)'}`,
              padding: '24px',
            },
          },
        },
      },
      shape: { borderRadius: 12 },
      templates: {
        page_wrap: {
          maxWidth: 'min(1440px, 100vw)',
          margin: 'auto',
          boxSizing: 'border-box',
          padding: 'clamp(20px, 4vw, 48px)',
        },
        subheading: {
          textTransform: 'uppercase',
          letterSpacing: '6px',
          fontWeight: '700',
        },
        boxOfChips: {
          display: 'flex',
          justifyContent: 'left',
          flexWrap: 'wrap',
          gap: '8px',
        },
        chip: ({ size, backgroundColor }) => ({
          height: `${size * 32}px`,
          minHeight: `${size * 32}px`,
          backgroundColor: backgroundColor || 'transparent',
          borderRadius: '16px',
          padding: '8px',
          margin: '4px',
        }),
        chipLabel: {
          display: 'flex',
          flexDirection: 'column',
        },
        chipLabelTitle: ({ size }) => ({
          fontSize: `${Math.max(size * 0.8, 0.8)}rem`,
          fontWeight: '500',
        }),
        chipLabelSubtitle: {
          fontSize: '0.7rem',
          opacity: 0.7,
        },
        chipContainer: {
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
        },
      },
      spacing: 8,
    });
  }, [mode]);

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </StyledEngineProvider>
  );
}
