import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { readWorkQueue } from './payablesChequesService';
import { buildWorkQueue } from './payablesWorkQueueModel';
import { PAYABLES_QUERY_ROOT, shortId } from './payablesUi';

export function WorkQueuePanel({ userId }: { userId: string }) {
  const queue = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'work-queue'], queryFn: readWorkQueue });
  const items = queue.data ? buildWorkQueue(queue.data, userId, new Date()) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>File de travail partagée</CardTitle>
        <CardDescription>Ce qui attend une action, qui s’en occupe et depuis quand.</CardDescription>
      </CardHeader>
      <CardContent>
        {queue.error && <p className="text-sm text-destructive">{(queue.error as Error).message}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action attendue</TableHead>
              <TableHead>Élément</TableHead>
              <TableHead>Ancienneté</TableHead>
              <TableHead>Traitement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={`${item.item_type}:${item.object_id}`}>
                <TableCell>{item.label}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(item.object_id)}</TableCell>
                <TableCell>{item.ageDays} j</TableCell>
                <TableCell>
                  {item.lockedByOther && <Badge variant="outline">En cours par un collègue</Badge>}
                  {item.lockedByMe && <Badge>En cours par vous</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {items.length === 0 && !queue.isLoading && <p className="text-sm text-muted-foreground">Rien en attente.</p>}
      </CardContent>
    </Card>
  );
}
