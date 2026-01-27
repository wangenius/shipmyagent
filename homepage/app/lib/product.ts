export type ShipMyAgentProduct = {
  name: string;
  productName: string;
  version: string;
  description: string;
  homepage?: string;
};

export const product: ShipMyAgentProduct = {
  name: "shipmyagent",
  productName: "ShipMyAgent",
  version: "1.0.0",
  description:
    "Turn your repository into a conversational, schedulable, and auditable Agent Runtime.",
  homepage: "https://github.com/wangenius/ShipMyAgent",
};
