import Badge from "@/components/base/Badge";
import { Link } from "react-router-dom";
import type { CommercialOpportunity } from "@/store/types";
import { Table, TBody, Td, Th, THead, Tr, TableWrap } from "@/components/base/Table";
import { COMMERCIAL_TONES } from "@/config/commercial";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { CommercialRow } from "@/pages/commercial/components/CommercialBoard";
import { formatDate } from "@/utils/format";

export default function CommercialTable({ rows, onEdit }: { rows: CommercialRow[]; onEdit?: (opportunity: CommercialOpportunity) => void }) {
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
          {onEdit ? <Th>Actions</Th> : null}
        </THead>
        <TBody>
          {rows.map(({ opp, lead }) => (
            <Tr key={opp.id}>
              <Td>
                <Link to={`/leads/${encodeURIComponent(opp.leadId)}`} className="font-semibold text-primary-700 hover:underline">{lead?.name ?? opp.leadId}</Link>
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
              {onEdit ? <Td><button type="button" className="font-semibold text-primary-700 hover:underline" onClick={() => onEdit(opp)}>Edit</button></Td> : null}
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}
