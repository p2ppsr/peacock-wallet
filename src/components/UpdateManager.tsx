import React, { useEffect, useState } from 'react';
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  LinearProgress,
  Box,
  Typography,
  Alert
} from '@mui/material';
import { Download as DownloadIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { toast } from 'react-toastify';
import { createDownloadProgressTracker, type DownloadProgressPercent } from './updateProgress';

interface UpdateManagerProps {
  checkOnMount?: boolean;
  interval?: number; // in milliseconds
}

const UpdateManager: React.FC<UpdateManagerProps> = ({
  checkOnMount = true, // Re-enabled now that GitHub API works
  interval = 3600000 // 1 hour
}) => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressPercent>(0);
  const [showDialog, setShowDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = async (silent = true) => {
    try {
      setError(null);
      const update = await check();
      if (update?.available) {
        setUpdateInfo(update);
        setUpdateAvailable(true);
        if (!silent) {
          setShowDialog(true);
        }
      } else {
        setUpdateAvailable(false);
        setUpdateInfo(null);
        if (!silent) {
          toast.success("You're running the latest version!");
        }
      }
    } catch (err: any) {
      console.error('Error type:', typeof err);
      console.error('Error constructor:', err.constructor.name);
      console.error('Error message:', err.message);
      console.error('Error string:', String(err));
      console.error('Error object:', err);
      console.error('Error properties:', Object.getOwnPropertyNames(err));
      
      // Try to extract more info
      if (err.cause) {
        console.error('Error cause:', err.cause);
      }
      if (err.stack) {
        console.error('Error stack:', err.stack);
      }
      if (err.name) {
        console.error('Error name:', err.name);
      }
      
      console.error('Full error details:', {
        message: err.message,
        code: err.code,
        cause: err.cause,
        stack: err.stack,
        name: err.name,
        toString: err.toString()
      });
      
      if (!silent) {
        const message = err.message || String(err) || 'Failed to check for updates';
        toast.error(message);
        setError(message);
      }
    }
  };

  const downloadAndInstall = async () => {
    if (!updateInfo) return;

    try {
      setDownloading(true);
      setDownloadProgress(0);
      setError(null);
      const trackDownloadProgress = createDownloadProgressTracker();
      
      // Download with progress tracking
      await updateInfo.downloadAndInstall((event: DownloadEvent) => {
        setDownloadProgress(trackDownloadProgress(event));
      });

      
      // Show success message and instruct user to restart
      setDownloading(false);
      setShowDialog(false);
      setUpdateAvailable(false);
      setUpdateInfo(null);
      toast.success('Update installed! Please restart the application.');
    } catch (err: any) {
      console.error('Error downloading update:', err);
      const message = err?.message || String(err || 'Failed to download update');
      setError(message);
      toast.error(message);
      setDownloading(false);
    }
  };

  const handleUpdateDialog = (action: 'install' | 'later' | 'skip') => {
    switch (action) {
      case 'install':
        downloadAndInstall();
        break;
      case 'later':
        setShowDialog(false);
        // Check again in 30 minutes
        setTimeout(() => setShowDialog(true), 30 * 60 * 1000);
        break;
      case 'skip':
        setShowDialog(false);
        setUpdateAvailable(false);
        break;
    }
  };

  // Check for updates on mount and set up interval
  useEffect(() => {
    if (checkOnMount) {
      // Initial check after a small delay
      setTimeout(() => checkForUpdates(true), 5000);
    }

    // Set up periodic checks
    if (interval > 0) {
      const intervalId = setInterval(() => checkForUpdates(true), interval);
      return () => clearInterval(intervalId);
    }

    return undefined;
  }, [checkOnMount, interval]);

  // Show update dialog when update is available
  useEffect(() => {
    if (updateAvailable && updateInfo && !showDialog) {
      setShowDialog(true);
    }
  }, [updateAvailable, updateInfo]);

  return (
    <>
      {/* Debug: Manual Check Button */}
      {/*process.env.NODE_ENV === 'development' && (
        <Button 
          onClick={() => checkForUpdates(false)} 
          variant="outlined" 
          size="small"
          sx={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999 }}
        >
          Check Updates (Debug)
        </Button>
      )*/}
      
      {/* Update Available Dialog */}
      <Dialog
        open={showDialog}
        onClose={() => handleUpdateDialog('later')}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DownloadIcon color="primary" />
          Update Available
        </DialogTitle>
        
        <DialogContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          
          <DialogContentText sx={{ mb: 2 }}>
            A new version of User Wallet is available.
            {updateInfo?.version && ` Version ${updateInfo.version} is ready to install.`}
          </DialogContentText>

          {updateInfo?.body && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                What's New:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {updateInfo.body}
              </Typography>
            </Box>
          )}

          {downloading && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" gutterBottom>
                Downloading update{downloadProgress === null ? '...' : `... ${downloadProgress}%`}
              </Typography>
              <LinearProgress
                variant={downloadProgress === null ? 'indeterminate' : 'determinate'}
                value={downloadProgress ?? undefined}
                sx={{ mb: 1 }}
              />
            </Box>
          )}
        </DialogContent>

        <DialogActions>
          <Button 
            onClick={() => handleUpdateDialog('skip')}
            disabled={downloading}
          >
            Skip This Version
          </Button>
          <Button 
            onClick={() => handleUpdateDialog('later')}
            disabled={downloading}
          >
            Remind Me Later
          </Button>
          <Button
            onClick={() => handleUpdateDialog('install')}
            variant="contained"
            disabled={downloading}
            startIcon={downloading ? <RefreshIcon /> : <DownloadIcon />}
          >
            {downloading ? 'Installing...' : 'Install Now'}
          </Button>
        </DialogActions>
      </Dialog>

    </>
  );
};

export default UpdateManager;

// Hook for manual update checks
export const useUpdateChecker = () => {
  const [checking, setChecking] = useState(false);
  
  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const update = await check();
      return update;
    } catch (err) {
      console.error('Error checking for updates:', err);
      throw err;
    } finally {
      setChecking(false);
    }
  };

  return { checkForUpdates, checking };
};
