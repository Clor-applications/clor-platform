import Markdown from 'react-markdown';

// Restrict operational messages to text formatting. Uploaded images and embedded HTML have separate workflows.
export default function AnnouncementText({ value }) {
  return <Markdown skipHtml allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'br']} unwrapDisallowed>{value}</Markdown>;
}
