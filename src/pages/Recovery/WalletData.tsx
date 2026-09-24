import { Box, Button, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import WalletDataPortability from '../../components/WalletBackups/WalletDataPortability';

export default function WalletDataRecovery() {
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', p: 3 }}>
      <Button component={Link} to="/">
        Back to sign in
      </Button>
      <Typography variant="h5" component="h1" sx={{ mt: 2 }}>
        Restore portable wallet data
      </Typography>
      <Typography sx={{ mt: 1 }}>
        Restore the data first, then sign in or recover the matching wallet keys. Restoring data
        does not replace your account recovery process.
      </Typography>
      <WalletDataPortability />
    </Box>
  );
}
