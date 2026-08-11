/* eslint-disable react/prop-types */
import React, { FC } from 'react'
import { Typography, Button, IconButton, Box } from '@mui/material'
import { ArrowBack } from '@mui/icons-material'
import style from './style'
import { Img } from '@bsv/uhrp-react'
import useSxStyles from '../../utils/useSxStyles'
import { useNavigate } from 'react-router-dom'

interface PageHeaderProps {
  title: string
  subheading: string | React.ReactNode
  icon: string
  buttonTitle: string
  buttonIcon?: React.ReactNode
  onClick: () => void
  showButton?: boolean
  showBackButton?: boolean
  onBackClick?: () => void
  // Optional secondary action button
  showSecondaryButton?: boolean
  secondaryButtonTitle?: string
  secondaryButtonIcon?: React.ReactNode
  onSecondaryClick?: () => void
  secondaryButtonVariant?: 'text' | 'outlined' | 'contained'
  secondaryButtonSize?: 'small' | 'medium' | 'large'
}

const PageHeader: FC<PageHeaderProps> = ({
  title,
  subheading,
  icon,
  buttonTitle,
  buttonIcon,
  onClick,
  showButton = true,
  showBackButton = true,
  onBackClick,
  showSecondaryButton = false,
  secondaryButtonTitle,
  secondaryButtonIcon,
  onSecondaryClick,
  secondaryButtonVariant = 'outlined',
  secondaryButtonSize = 'large',
}) => {
  const styles = useSxStyles(style)
  const navigate = useNavigate()
  const handleBack = onBackClick || (() => navigate(-1))

  return (
    <Box>
      <Box sx={styles.top_grid}>
        <Box>
          {showBackButton && (
            <IconButton
              sx={styles.back_button}
              onClick={handleBack}
              size="large"
              aria-label="Go back"
            >
              <ArrowBack />
            </IconButton>
          )}
        </Box>
        <Box>
          <Box
            component={Img}
            sx={styles.app_icon}
            src={icon}
            alt={title}
          />
        </Box>
        <Box>
          <Typography variant="h1" color="textPrimary" sx={{ mb: 1 }}>
            {title}
          </Typography>
          {typeof subheading === 'string' ? (
            <Typography color="textSecondary">{subheading}</Typography>
          ) : (
            <Box>{subheading}</Box>
          )}
        </Box>
        <Box>
          {showSecondaryButton && secondaryButtonTitle && (
            <Button
              sx={{ ...styles.action_button, mr: showButton ? 1 : 0 }}
              variant={secondaryButtonVariant}
              color="primary"
              size={secondaryButtonSize}
              startIcon={secondaryButtonIcon}
              onClick={onSecondaryClick}
            >
              {secondaryButtonTitle}
            </Button>
          )}
          {showButton && (
            <Button
              sx={styles.action_button}
              variant="contained"
              color="primary"
              size="large"
              endIcon={buttonIcon}
              onClick={onClick}
            >
              {buttonTitle}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  )
}

export default PageHeader
