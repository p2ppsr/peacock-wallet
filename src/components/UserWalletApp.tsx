import React from 'react'
import { Card, CardActionArea, Typography, Box, Stack } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { generateDefaultIcon } from '../constants/popularApps'
import Img from './UhrpImg'

interface UserWalletAppProps {
  iconImageUrl?: string
  domain: string
  appName?: string
  onClick?: (event: React.MouseEvent<HTMLElement, MouseEvent>) => void
  clickable?: boolean
}

const UserWalletApp: React.FC<UserWalletAppProps> = ({
  iconImageUrl,
  domain,
  appName,
  onClick,
  clickable = true,
}) => {
  const navigate = useNavigate()

  // Although TypeScript enforces the domain type, this runtime check preserves original logic.
  if (typeof domain !== 'string') {
    throw new Error('Error in UserWalletApp Component: domain prop must be a string!')
  }

  // Fallback to domain if appName is not provided.
  const displayName = appName || domain

  const resolvedIconImageUrl = iconImageUrl || generateDefaultIcon(displayName)

  const handleClick = (e: React.MouseEvent<HTMLElement, MouseEvent>): void => {
    if (clickable) {
      if (typeof onClick === 'function') {
        onClick(e)
      } else {
        e.stopPropagation()
        navigate(`/dashboard/app/${encodeURIComponent(domain)}`, {
          state: {
            domain,
            appName: displayName,
            iconImageUrl: resolvedIconImageUrl,
          },
        })
      }
    }
  }

  return (
    <Card
      elevation={0}
      sx={{ height: '100%', width: '100%' }}
    >
      <CardActionArea disabled={!clickable} onClick={handleClick} sx={{ height: '100%', p: 2.5 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              width: 56,
              height: 56,
              flexShrink: 0,
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <Img
              src={resolvedIconImageUrl}
              alt={displayName}
              style={{
                objectFit: 'contain',
                width: '100%',
                height: '100%',
              }}
            />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography fontWeight={700} noWrap>{displayName}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>{domain}</Typography>
          </Box>
        </Stack>
      </CardActionArea>
    </Card>
  )
}

export default UserWalletApp
