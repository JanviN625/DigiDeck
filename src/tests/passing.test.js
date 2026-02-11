import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';

test('app displays a link to learn React - should exist = pass', () => {
  render(<App />);
  const linkElement = screen.getByText(/learn react/i);
  expect(linkElement).toBeInTheDocument();
});
