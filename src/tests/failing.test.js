import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';

test('the app displays a Get Started button - should not exist = failure', () => {
  render(<App />);
  const buttonElement = screen.getByText(/get started/i);
  expect(buttonElement).toBeInTheDocument();
});
