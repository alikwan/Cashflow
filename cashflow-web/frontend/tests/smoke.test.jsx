import { render } from "@testing-library/react";
import App from "../src/App";

test("app mounts and document dir is rtl", () => {
  render(<App />);
  expect(document.documentElement.dir).toBe("rtl");
});
