import { Tenant } from "@prisma/client";

export const isDescendant = ({
  potentialParent,
  potentialChild,
}: {
  potentialParent: Tenant;
  potentialChild: Tenant;
}) => {
  //TODO: expand this when we have the full metatenancy hierarchy synced
  return (
    !potentialChild.isGlobal &&
    potentialParent.isGlobal &&
    potentialChild.partnerId === potentialParent.partnerId
  );
};