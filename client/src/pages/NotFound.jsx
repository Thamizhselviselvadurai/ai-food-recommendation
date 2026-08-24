import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <EmptyState
      emoji="🍽️"
      title="Nothing here"
      description="That page does not exist. The food, however, does."
      action={<Link to="/" className="btn-primary mt-2">Back to home</Link>}
    />
  );
}
