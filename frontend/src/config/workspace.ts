export interface WorkspaceUser {
  name: string;
  role: string;
  email: string;
  team: string;
}

export const CURRENT_USER: WorkspaceUser = {
  name: "Amara Whitfield",
  role: "Admissions Manager",
  email: "a.whitfield@kentbusinesscollege.ac.uk",
  team: "Admissions & Sales",
};

export const WORKSPACE = {
  name: "Kent Business College",
  product: "Workspace",
  environment: "Demonstration",
};