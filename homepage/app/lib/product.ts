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
  description: "Ship your Repo as Agent",
  homepage: "https://github.com/wangenius/ShipMyAgent",
};

