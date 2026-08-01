import React, { useState, useContext } from 'react';
import { Typography, Button, Grid, LinearProgress, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { WalletContext } from '../../WalletContext';
import { WalletSettings } from '@bsv/wallet-toolbox-client';

type ModeOption = 'light' | 'dark';

type ModeVisualTokens = {
  label: string;
  backgroundColor: string;
  backgroundImageLayers: string[];
  backgroundBlendMode: string;
  textPrimary: string;
  textSecondary: string;
  surfaceGradient: string;
  surfaceBorderColor: string;
  surfaceShadow: string;
  accentMain: string;
  accentSoft: string;
  accentContrast: string;
  accentGradient: string;
  chipBackground: string;
  buttonRestShadow: string;
  buttonActiveShadow: string;
  focusRing: string;
  previewIconBackground: string;
};

const MODE_VISUAL_TOKENS: Record<ModeOption, ModeVisualTokens> = {
  light: {
    label: 'Light',
    backgroundColor: '#F4F6F8',
    backgroundImageLayers: [
      'radial-gradient(circle at 20% 18%, rgba(93,226,194,0.18), transparent 42%)',
      'radial-gradient(circle at 78% 12%, rgba(255,155,115,0.18), transparent 36%)',
      'linear-gradient(180deg, #F7F9FB 0%, #EDF2F7 100%)',
    ],
    backgroundBlendMode: 'normal, normal, normal',
    textPrimary: '#0F1624',
    textSecondary: '#4B5565',
    surfaceGradient: 'linear-gradient(145deg, rgba(255,255,255,0.96), rgba(241,245,250,0.94))',
    surfaceBorderColor: 'rgba(14,138,114,0.18)',
    surfaceShadow: '0 32px 64px rgba(15,22,36,0.12)',
    accentMain: '#0E8A72',
    accentSoft: 'rgba(14,138,114,0.2)',
    accentContrast: '#F8FAFB',
    accentGradient: 'linear-gradient(120deg, #0E8A72, #FF8A3D)',
    chipBackground: 'rgba(14,138,114,0.12)',
    buttonRestShadow: '0 12px 28px rgba(14,138,114,0.12)',
    buttonActiveShadow: '0 22px 44px rgba(14,138,114,0.18)',
    focusRing: '0 0 0 4px rgba(255,138,61,0.18)',
    previewIconBackground: 'linear-gradient(135deg, rgba(14,138,114,0.15), rgba(255,138,61,0.2))',
  },
  dark: {
    label: 'Dark',
    backgroundColor: '#050A12',
    backgroundImageLayers: [
      'radial-gradient(circle at 16% 18%, rgba(93,226,194,0.2), transparent 34%)',
      'radial-gradient(circle at 78% 12%, rgba(255,155,115,0.2), transparent 30%)',
      'linear-gradient(180deg, #050A12 0%, #0B1422 100%)',
    ],
    backgroundBlendMode: 'normal, normal, normal',
    textPrimary: '#EAF1FB',
    textSecondary: '#9FB3C5',
    surfaceGradient: 'linear-gradient(145deg, rgba(12,18,30,0.94), rgba(17,26,38,0.92))',
    surfaceBorderColor: 'rgba(255,255,255,0.08)',
    surfaceShadow: '0 28px 56px rgba(0, 0, 0, 0.65)',
    accentMain: '#5DE2C2',
    accentSoft: 'rgba(93,226,194,0.25)',
    accentContrast: '#050A12',
    accentGradient: 'linear-gradient(120deg, #3AC9AA, #FF9B73)',
    chipBackground: 'rgba(93,226,194,0.14)',
    buttonRestShadow: '0 18px 36px rgba(0, 0, 0, 0.55)',
    buttonActiveShadow: '0 28px 52px rgba(0, 0, 0, 0.65)',
    focusRing: '0 0 0 4px rgba(93,226,194,0.28)',
    previewIconBackground: 'linear-gradient(135deg, rgba(93,226,194,0.18), rgba(255,155,115,0.2))',
  },
};

const ModePreview: React.FC<{ tokens: ModeVisualTokens }> = ({ tokens }) => (
  <Box
    sx={{
      width: 64,
      height: 64,
      borderRadius: 2.5,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundImage: tokens.previewIconBackground,
      color: tokens.textPrimary,
      fontSize: '0.75rem',
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      border: '1px solid',
      borderColor: tokens.surfaceBorderColor,
      boxShadow: `inset 0 -6px 12px ${tokens.accentSoft}`,
    }}
  >
    {tokens.label}
  </Box>
);

const Welcome: React.FC = () => {
  const { settings, updateSettings } = useContext(WalletContext);
  const navigate = useNavigate();
  const [settingsLoading, setSettingsLoading] = useState<boolean>(false);

  const currencies: Record<string, string> = {
    USD: '$10',
    BSV: '0.033',
    SATS: '3,333,333',
    EUR: '€9.15',
    GBP: '£7.86',
  };
  const modes: ModeOption[] = ['light', 'dark'];

  const [selectedTheme, setSelectedTheme] = useState<ModeOption>(
    settings?.theme?.mode === 'dark' ? 'dark' : 'light'
  );
  const [selectedCurrency, setSelectedCurrency] = useState<string>(settings?.currency || 'USD');

  const tokens = MODE_VISUAL_TOKENS[selectedTheme];
  const backgroundImage = tokens.backgroundImageLayers.join(', ');

  const handleThemeChange = (mode: ModeOption) => {
    setSelectedTheme(mode);
  };

  const handleCurrencyChange = (currency: string) => {
    setSelectedCurrency(currency);
  };

  const showDashboard = async () => {
    try {
      setSettingsLoading(true);
      const newSettings: Partial<WalletSettings> = {
        theme: { mode: selectedTheme },
        currency: selectedCurrency,
      };
      await updateSettings(newSettings as WalletSettings);
      navigate('/dashboard/home');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSettingsLoading(false);
    }
  };

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: { xs: 2.5, sm: 4, md: 6 },
        py: { xs: 4, md: 8 },
        backgroundColor: tokens.backgroundColor,
        backgroundImage,
        backgroundBlendMode: tokens.backgroundBlendMode,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
        backgroundRepeat: 'no-repeat',
        color: tokens.textPrimary,
        overflowY: 'auto',
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 720,
          textAlign: 'center',
          px: { xs: 3, sm: 6 },
          py: { xs: 4, sm: 6 },
          borderRadius: { xs: 3, sm: 4 },
          backgroundImage: tokens.surfaceGradient,
          border: '1px solid',
          borderColor: tokens.surfaceBorderColor,
          boxShadow: tokens.surfaceShadow,
          backdropFilter: 'blur(24px)',
          color: tokens.textSecondary,
        }}
      >
        <Grid container direction="column" alignItems="center" spacing={3}>
          <Grid item xs={12}>
            <Typography variant="h1" paragraph sx={{ color: tokens.textPrimary }}>
              Welcome to User Wallet
            </Typography>
            <Typography variant="h4" sx={{ color: tokens.textPrimary, opacity: 0.92 }}>
              Tune your preferences before stepping into the new workspace.
            </Typography>
            <Typography
              paragraph
              sx={{
                pt: 4,
                color: tokens.textSecondary,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Default Theme
            </Typography>
          </Grid>
          <Grid item container spacing={3} justifyContent="center">
            {modes.map((mode) => {
              const modeTokens = MODE_VISUAL_TOKENS[mode];
              const isSelected = selectedTheme === mode;

              return (
                <Grid item key={mode}>
                  <Button
                    onClick={() => handleThemeChange(mode)}
                    sx={{
                      width: { xs: 140, sm: 160 },
                      height: { xs: 140, sm: 168 },
                      borderRadius: 3.5,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                      px: { xs: 3, sm: 4 },
                      py: { xs: 3, sm: 4 },
                      textAlign: 'center',
                      backgroundImage: modeTokens.surfaceGradient,
                      border: '1px solid',
                      borderColor: isSelected ? modeTokens.accentMain : modeTokens.surfaceBorderColor,
                      color: modeTokens.textPrimary,
                      boxShadow: isSelected ? modeTokens.buttonActiveShadow : modeTokens.buttonRestShadow,
                      transform: isSelected ? 'translateY(-4px)' : 'translateY(0)',
                      backdropFilter: 'blur(18px)',
                      transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                      '&:hover': {
                        borderColor: modeTokens.accentMain,
                        boxShadow: modeTokens.buttonActiveShadow,
                        transform: 'translateY(-4px)',
                      },
                      '&:focus-visible': {
                        outline: 'none',
                        boxShadow: `${modeTokens.buttonActiveShadow}, ${modeTokens.focusRing}`,
                      },
                    }}
                  >
                    <ModePreview tokens={modeTokens} />
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: modeTokens.textSecondary,
                      }}
                    >
                      {modeTokens.label} Mode
                    </Typography>
                  </Button>
                </Grid>
              );
            })}
          </Grid>
          <Grid
            container
            spacing={2}
            justifyContent="center"
            alignItems="center"
            sx={{ pt: 2, px: { xs: 0, sm: 4 } }}
          >
            <Grid item xs={12} sx={{ pb: 1 }}>
              <Typography variant="h5" sx={{ color: tokens.textPrimary, pb: 1 }}>
                Default Currency
              </Typography>
              <Typography variant="body1" sx={{ color: tokens.textSecondary }}>
                How would you like to see your account balance?
              </Typography>
            </Grid>
            <Grid item xs={12} container direction="row" justifyContent="center" alignItems="center" spacing={2}>
              {Object.keys(currencies).map((currency) => {
                const isSelected = selectedCurrency === currency;

                return (
                  <Grid item key={currency}>
                    <Button
                      variant={isSelected ? 'contained' : 'outlined'}
                      color="primary"
                      onClick={() => handleCurrencyChange(currency)}
                      sx={{
                        borderRadius: 3,
                        minWidth: { xs: 120, sm: 140 },
                        px: 3,
                        py: 2.5,
                        backgroundImage: isSelected ? tokens.accentGradient : 'none',
                        backgroundColor: isSelected ? 'transparent' : tokens.chipBackground,
                        color: isSelected ? tokens.accentContrast : tokens.textPrimary,
                        border: '1px solid',
                        borderColor: isSelected ? tokens.accentMain : tokens.surfaceBorderColor,
                        boxShadow: isSelected ? tokens.buttonActiveShadow : 'none',
                        transform: isSelected ? 'translateY(-3px)' : 'translateY(0)',
                        transition:
                          'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background-color 0.18s ease',
                        backdropFilter: 'blur(12px)',
                        '&:hover': {
                          backgroundImage: isSelected ? tokens.accentGradient : 'none',
                          backgroundColor: isSelected ? 'transparent' : tokens.chipBackground,
                          borderColor: tokens.accentMain,
                          boxShadow: tokens.buttonActiveShadow,
                          transform: 'translateY(-3px)',
                        },
                      }}
                    >
                      <Box>
                        <Typography
                          variant="h6"
                          sx={{ color: isSelected ? tokens.accentContrast : tokens.textPrimary }}
                        >
                          {currency}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: isSelected ? tokens.accentContrast : tokens.textSecondary }}
                        >
                          {currencies[currency]}
                        </Typography>
                      </Box>
                    </Button>
                  </Grid>
                );
              })}
            </Grid>
          </Grid>
          <Grid container sx={{ pt: 4 }}>
            <Grid item xs={12}>
              {settingsLoading ? (
                <LinearProgress color="primary" />
              ) : (
                <Button color="primary" variant="contained" size="large" onClick={showDashboard}>
                  View Dashboard
                </Button>
              )}
            </Grid>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
};

export default Welcome;
