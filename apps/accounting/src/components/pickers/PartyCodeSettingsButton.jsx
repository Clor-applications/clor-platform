import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import Drawer from '@ui/components/ui/Drawer';
import CodeNumberingSettings from '../../features/settings/CodeNumberingSettings';

export default function PartyCodeSettingsButton({ currentCompany, db, setDb, kind }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="ui-btn ui-btn-secondary !px-2" title="Open code numbering settings" aria-label="Open code numbering settings" onClick={() => setOpen(true)}><Settings2 size={15} /></button>
    <Drawer open={open} onClose={() => setOpen(false)} title="Code Numbering" widthClass="ui-form-drawer"><CodeNumberingSettings db={db} setDb={setDb} currentCompany={currentCompany} initialKind={kind} embedded /></Drawer>
  </>;
}
