import React, { ReactNode } from 'react';
import {
  Typography,
  useMediaQuery,
  DialogProps,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Box
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

interface CustomDialogProps extends DialogProps {
  title: string;
  children: ReactNode;
  description?: string;
  actions?: ReactNode;
  minWidth?: string;
  icon?: ReactNode;
}

// Permission payloads can contain hashes, public keys, protocol IDs, and URLs
// with no natural break points. Keep every nested flex item shrinkable and make
// arbitrary text wrap before it can widen the dialog.
export const overflowSafeDialogContentSx = {
  minWidth: 0,
  maxWidth: '100%',
  overflowWrap: 'anywhere',
  '& .MuiDialogContent-root, & .MuiDialogActions-root, & .MuiStack-root, & .MuiBox-root': {
    minWidth: 0,
    maxWidth: '100%'
  },
  '& .MuiTypography-root': {
    minWidth: 0,
    maxWidth: '100%',
    overflowWrap: 'anywhere'
  },
  '& .MuiChip-root': {
    maxWidth: '100%'
  },
  '& .MuiChip-label': {
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }
} as const;

const CustomDialog: React.FC<CustomDialogProps> = ({ 
  title, 
  description,
  icon,
  children, 
  actions,
  className = '',
  ...props 
}) => {
  // No longer need classes from useStyles
  const theme = useTheme();
  const isFullscreen = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Dialog
      maxWidth={isFullscreen ? undefined : 'sm'}
      fullWidth={!isFullscreen}
      fullScreen={isFullscreen}
      className={className}
      {...props}
    >
      <DialogTitle sx={{ minWidth: 0, maxWidth: '100%' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          {icon} <Typography variant="h5" fontWeight="bold" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{title}</Typography>
        </Stack>
      </DialogTitle>
      {description && <Box sx={{ px: 5, py: 3, minWidth: 0 }}><Typography variant="body1" color="textSecondary" sx={{ overflowWrap: 'anywhere' }}>{description}</Typography></Box>}
      <DialogContent sx={overflowSafeDialogContentSx}>{children}</DialogContent>
      {actions && (
        <DialogActions>
          {actions}
        </DialogActions>
      )}
    </Dialog>
  );
};

export default CustomDialog;
