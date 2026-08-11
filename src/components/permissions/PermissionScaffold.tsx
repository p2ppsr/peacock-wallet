import { ReactNode } from 'react'
import { Box, Stack, Typography, Chip } from '@mui/material'
import { SxProps, Theme } from '@mui/material/styles'
import deterministicColor from '../../utils/deterministicColor'

type InfoRowProps = {
  label: string
  value: ReactNode
  muted?: boolean
}

type PermissionHeaderProps = {
  appDomain?: string
  contextLine?: string
  gradient?: string
}

type RequestCardProps = {
  title: string
  body: ReactNode
}

type SurfaceProps = {
  children: ReactNode
  sx?: SxProps<Theme>
}

const surfaceBase: SxProps<Theme> = {
  p: 2,
  borderRadius: 2,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: 'background.paper',
  boxShadow: 'none'
}

/** Shared surface styling for dark, elevated panels */
export const Surface = ({ children, sx }: SurfaceProps) => (
  <Box sx={{ ...surfaceBase, ...sx }}>
    {children}
  </Box>
)

/** Simple row for label/value pairs */
export const InfoRow = ({ label, value, muted }: InfoRowProps) => (
  <Stack
    direction="row"
    justifyContent="space-between"
    alignItems="flex-start"
    spacing={2}
    sx={{
      py: 1.25,
      px: 1,
      borderRadius: 1.5,
      backgroundColor: 'action.hover',
      border: '1px solid',
      borderColor: 'divider'
    }}
  >
    <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.8, color: 'text.secondary' }}>
      {label}
    </Typography>
    <Typography
      variant="body1"
      sx={{
        fontWeight: 700,
        color: muted ? 'text.secondary' : 'text.primary',
        textAlign: 'right',
        wordBreak: 'break-word',
        maxWidth: '65%'
      }}
    >
      {value}
    </Typography>
  </Stack>
)

/** Prominent header that centers the requesting app */
export const PermissionHeader = ({ appDomain, contextLine, gradient }: PermissionHeaderProps) => {
  const accent = gradient || deterministicColor(appDomain || 'app')

  return (
    <Box
      sx={{
        backgroundImage: accent,
        color: '#fff',
        borderRadius: 2.5,
        p: 2.5,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.15)'
      }}
    >
      <Box sx={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.15), transparent 35%), radial-gradient(circle at 80% 30%, rgba(255,255,255,0.12), transparent 30%)',
        opacity: 0.9
      }} />
      <Chip
        label="APP"
        size="small"
        sx={{
          bgcolor: 'rgba(0,0,0,0.35)',
          color: '#fff',
          fontWeight: 700,
          border: '1px solid rgba(255,255,255,0.35)'
        }}
      />
      <Stack spacing={0.5} sx={{ position: 'relative', zIndex: 1 }}>
        <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.9)', letterSpacing: 1 }}>
          {contextLine || 'is asking for permission'}
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#fff' }}>
          {appDomain || 'Unknown app'}
        </Typography>
      </Stack>
    </Box>
  )
}

/** Compact card used to explain what the app wants */
export const RequestCard = ({ title, body }: RequestCardProps) => (
  <Surface sx={{ mt: 1 }}>
    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
      {title}
    </Typography>
    <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.6 }}>
      {body}
    </Typography>
  </Surface>
)

export default {
  InfoRow,
  PermissionHeader,
  RequestCard
}
