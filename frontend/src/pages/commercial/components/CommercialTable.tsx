import Badge from "@/components/base/Badge";
import { Table, TBody, Td, Th, THead, Tr, TableWrap } from "@/components/base/Table";
import { COMMERCIAL_TONES } from "@/config/commercial";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { CommercialRow } from "@/pages/commercial/components/CommercialBoard";
import { formatDate } from "@/utils/format";

export default function CommercialTable({ rows }: { rows: CommercialRow[] }) {
  const { userName } = useWorkspace();
  return (
    <TableWrap>
      <Table className="min-w-[960px]">
        <THead>
          <Th>Lead</Th>
          <Th>Programme</Th>
          <Th>Option type</Th>
          <Th>Funding</Th>
          <Th>Budget</Th>
          <Th>Quote</Th>
          <Th>Stage</Th>
          <Th>Owner</Th>
          <Th>Follow-up</Th>
        </THead>
        <TBody>
          {rows.map(({ opp, lead }) => (
            <Tr key={opp.id}>
              <Td>
                <span className="font-semibold text-foreground-900">{lead?.name ?? opp.leadId}</span>
                <span className="block text-[11px] text-foreground-400">{opp.referralReason}</span>
              </Td>
              <Td>{opp.suggestedProgramme}</Td>
              <Td>{opp.optionType}</Td>
              <Td>{opp.fundingInterest}</Td>
              <Td>{opp.budgetStatus}</Td>
              <Td>{opp.quoteStatus}</Td>
              <Td>
                <Badge tone={COMMERCIAL_TONES[opp.stage]}>{opp.stage}</Badge>
              </Td>
              <Td>{userName(opp.commercialOwnerId)}</Td>
              <Td>{formatDate(opp.nextFollowUpAt)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}