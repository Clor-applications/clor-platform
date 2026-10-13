import { ProfileScreen } from '@ui/profile/ProfileScreen';

import SettingsScreenHeader from './SettingsScreenHeader';

/**
 * My profile inside Accounting's settings. The page itself is shared (the
 * shell shows the same one for apps that use its menu); Accounting only
 * supplies its settings header, which moves the actions into the frame.
 */
export const ProfileSettings = () => <ProfileScreen Header={SettingsScreenHeader} />;

export default ProfileSettings;
