import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Bold, Italic, List } from 'lucide-react';

export default function AnnouncementEditor({ id, label, value, onChange }) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown], content: value || '', contentType: 'markdown',
    editorProps: { attributes: { id, role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', class: 'ui-input min-h-24' } },
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
  });
  return <div className="sm:col-span-2">
    <span className="ui-label">{label}</span>
    <div className="flex gap-1" role="toolbar" aria-label="Message formatting">
      {[[Bold, 'Bold', 'toggleBold'], [Italic, 'Italic', 'toggleItalic'], [List, 'Bulleted list', 'toggleBulletList']].map(([Icon, name, action]) =>
        <button key={name} type="button" aria-label={name} title={name} className="ui-icon-btn" onClick={() => editor?.chain().focus()[action]().run()}><Icon size={15} /></button>)}
    </div>
    <EditorContent editor={editor} />
  </div>;
}
