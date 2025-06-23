
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { BankReport } from '@/types/banking';

interface ConsolidatedChartsProps {
  bankReports: BankReport[];
}

const ConsolidatedCharts: React.FC<ConsolidatedChartsProps> = ({ bankReports }) => {
  // Données pour les graphiques consolidés
  const bankBalanceData = bankReports.map(report => ({
    bank: report.bank,
    opening: report.openingBalance / 1000000,
    closing: report.closingBalance / 1000000,
    movement: (report.closingBalance - report.openingBalance) / 1000000
  }));

  const facilityUtilizationData = bankReports.map(report => {
    const totalLimit = report.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0);
    const totalUsed = report.bankFacilities.reduce((sum, f) => sum + f.usedAmount, 0);
    return {
      bank: report.bank,
      limit: totalLimit / 1000000,
      used: totalUsed / 1000000,
      utilization: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0,
      available: (totalLimit - totalUsed) / 1000000
    };
  });

  const riskData = bankReports.map(report => {
    const impayesAmount = report.impayes.reduce((sum, i) => sum + i.montant, 0);
    const variation = Math.abs(report.closingBalance - report.openingBalance);
    return {
      bank: report.bank,
      impayes: impayesAmount / 1000000,
      variation: variation / 1000000,
      riskScore: (impayesAmount / 1000000) + (variation / 2000000) // Score de risque simple
    };
  });

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF7C7C'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Mouvements par Banque (Millions FCFA)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              opening: { label: "Ouverture", color: "#8884d8" },
              closing: { label: "Clôture", color: "#82ca9d" },
              movement: { label: "Mouvement", color: "#ff7300" }
            }}
            className="h-80"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bankBalanceData}>
                <XAxis dataKey="bank" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="opening" fill="#8884d8" name="Ouverture" />
                <Bar dataKey="closing" fill="#82ca9d" name="Clôture" />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Utilisation des Facilités par Banque</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              utilization: { label: "Utilisation %", color: "#ff7300" }
            }}
            className="h-80"
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={facilityUtilizationData}
                  dataKey="utilization"
                  nameKey="bank"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="#8884d8"
                  label={(entry) => `${entry.bank}: ${entry.utilization.toFixed(1)}%`}
                >
                  {facilityUtilizationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Analyse de Risque par Banque</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              impayes: { label: "Impayés", color: "#ff4444" },
              variation: { label: "Variation", color: "#ffaa00" }
            }}
            className="h-80"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskData}>
                <XAxis dataKey="bank" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="impayes" fill="#ff4444" name="Impayés (M)" />
                <Bar dataKey="variation" fill="#ffaa00" name="Variation (M)" />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tendance des Facilités (Disponibles vs Utilisées)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              available: { label: "Disponible", color: "#00C49F" },
              used: { label: "Utilisé", color: "#FF8042" }
            }}
            className="h-80"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={facilityUtilizationData}>
                <XAxis dataKey="bank" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="available" stroke="#00C49F" strokeWidth={2} name="Disponible (M)" />
                <Line type="monotone" dataKey="used" stroke="#FF8042" strokeWidth={2} name="Utilisé (M)" />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConsolidatedCharts;
