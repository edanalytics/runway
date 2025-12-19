import { BiAlarm, BiEdit, BiTrash } from 'react-icons/bi';
import { PageTemplate } from './PageTemplate';
import { Box } from '@chakra-ui/react';
import { Meta } from '@storybook/react';
import {
  PageActions,
  Attribute,
  AttributesGrid,
  ContentSection,
  PageContentCard,
  PageSectionActions,
} from '..';
import { faker } from '@faker-js/faker';
import { Standard } from '../stdTable/StdTable.stories';
const ExampleActions = () => (
  <PageActions
    show={2}
    actions={{
      0: {
        icon: BiEdit,
        text: 'Edit',
        title: 'Edit the thingy',
        onClick: () => undefined,
      },
      1: {
        icon: BiTrash,
        text: 'Delete',
        title: 'Delete the thingy',
        onClick: () => undefined,
      },
      2: {
        icon: BiTrash,
        text: 'Delete',
        title: 'Delete the thingy',
        onClick: () => undefined,
      },
      3: {
        icon: BiTrash,
        text: 'Delete',
        title: 'Delete the thingy',
        onClick: () => undefined,
      },
    }}
  />
);
const meta: Meta<typeof PageTemplate> = {
  title: 'PageTemplate',
  component: PageTemplate,
  decorators: [
    (Story) => (
      <Box bg="background-bg" p="4em">
        <Story />
      </Box>
    ),
  ],
};
export default meta;

export const WithActions = () => (
  <PageTemplate title="Page Title" actions={<ExampleActions />}>
    Hello world
  </PageTemplate>
);

const generateAttributes = (count: number) =>
  new Array(count).fill(0).map((_, i) => {
    const baseProps = {
      key: i,
      label: faker.commerce.productName(),
      isCopyable: faker.datatype.boolean(),
    };
    const type = faker.helpers.arrayElement([
      'date' as const,
      'url' as const,
      'words' as const,
      'boolean' as const,
      'number' as const,
      'secret' as const,
      'secret' as const,
    ]);
    switch (type) {
      case 'date':
        return (
          <Attribute
            {...baseProps}
            {...{
              value: faker.date.past(),
              isDate: true,
              defaultDateFmt: faker.helpers.arrayElement([undefined, 0, 1, 2]),
            }}
          />
        );
      case 'url':
        return (
          <Attribute
            {...baseProps}
            {...{
              value: faker.internet.url(),
              isUrl: true,
            }}
          />
        );
      case 'words':
        return (
          <Attribute
            {...baseProps}
            {...{
              value: faker.lorem.words(3),
            }}
          />
        );
      case 'boolean':
        return (
          <Attribute
            {...baseProps}
            {...{
              value: faker.datatype.boolean(),
            }}
          />
        );
      case 'number':
        return (
          <Attribute
            {...baseProps}
            {...{
              value: faker.datatype.number(),
            }}
          />
        );
      case 'secret':
        return (
          <Attribute
            {...baseProps}
            {...{
              value: faker.datatype.hexadecimal(32),
              isMasked: faker.datatype.boolean(),
            }}
          />
        );
    }
  });

export const WithoutActions = () => <PageTemplate title="Page Title">Hello world</PageTemplate>;

export const WithAttributesGrid = () => (
  <PageTemplate title="Page Title">
    <ContentSection>
      <AttributesGrid>{generateAttributes(11)}</AttributesGrid>
    </ContentSection>
    <ContentSection heading="Another section">
      <AttributesGrid>{generateAttributes(7)}</AttributesGrid>
    </ContentSection>
  </PageTemplate>
);

export const WithCustomSection = () => (
  <PageTemplate title="Page Title">
    <ContentSection heading="My table">
      <Standard enableRowSelection />
    </ContentSection>
    <ContentSection heading="Another section">
      <AttributesGrid>{generateAttributes(5)}</AttributesGrid>
    </ContentSection>
  </PageTemplate>
);

export const NoSectionHeadings = () => (
  <PageTemplate title="Page Title">
    <ContentSection>
      <AttributesGrid>{generateAttributes(5)}</AttributesGrid>
    </ContentSection>
    <ContentSection>
      <AttributesGrid>{generateAttributes(3)}</AttributesGrid>
    </ContentSection>
  </PageTemplate>
);

const actions = {
  Bah: {
    confirm: true,
    icon: BiTrash,
    text: 'Delete',
    title: 'Delete the thingy',
    onClick: () => undefined,
  },
  Bah2: {
    icon: BiAlarm,
    text: 'Blub',
    title: 'Blub the thingy',
    onClick: () => undefined,
  },
};
export const SectionActions = () => (
  <PageTemplate
    title="Page Title"
    customPageContentCard
    actions={<PageActions actions={actions} />}
  >
    <PageContentCard className="content-section">
      <ContentSection heading="Content section">
        <AttributesGrid>{generateAttributes(5)}</AttributesGrid>
      </ContentSection>
    </PageContentCard>
    <PageContentCard>
      <PageSectionActions actions={actions} />
      <ContentSection heading="Other content section">
        <AttributesGrid>{generateAttributes(3)}</AttributesGrid>
      </ContentSection>
    </PageContentCard>
  </PageTemplate>
);
