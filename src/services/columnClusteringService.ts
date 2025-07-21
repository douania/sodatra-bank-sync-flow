
export interface ClusterResult {
  clusters: number[][];
  centroids: number[];
  labels: number[];
}

export class ColumnClusteringService {
  
  /**
   * Applique l'algorithme K-means pour regrouper les positions X en colonnes
   */
  kMeans(positions: number[], k: number, maxIterations: number = 100): ClusterResult {
    if (positions.length === 0 || k <= 0) {
      return { clusters: [], centroids: [], labels: [] };
    }
    
    if (k >= positions.length) {
      // Si on demande plus de clusters que de points, chaque point est son propre cluster
      return {
        clusters: positions.map(p => [p]),
        centroids: [...positions],
        labels: positions.map((_, i) => i)
      };
    }
    
    // Initialiser les centroïdes de manière équilibrée
    const sortedPositions = [...positions].sort((a, b) => a - b);
    const min = sortedPositions[0];
    const max = sortedPositions[sortedPositions.length - 1];
    
    let centroids: number[] = [];
    for (let i = 0; i < k; i++) {
      centroids.push(min + (max - min) * (i + 1) / (k + 1));
    }
    
    let labels = new Array(positions.length).fill(0);
    let hasChanged = true;
    let iterations = 0;
    
    while (hasChanged && iterations < maxIterations) {
      hasChanged = false;
      
      // Assigner chaque point au centroïde le plus proche
      for (let i = 0; i < positions.length; i++) {
        let minDistance = Infinity;
        let newLabel = 0;
        
        for (let j = 0; j < k; j++) {
          const distance = Math.abs(positions[i] - centroids[j]);
          if (distance < minDistance) {
            minDistance = distance;
            newLabel = j;
          }
        }
        
        if (labels[i] !== newLabel) {
          labels[i] = newLabel;
          hasChanged = true;
        }
      }
      
      // Recalculer les centroïdes
      const newCentroids = new Array(k).fill(0);
      const counts = new Array(k).fill(0);
      
      for (let i = 0; i < positions.length; i++) {
        newCentroids[labels[i]] += positions[i];
        counts[labels[i]]++;
      }
      
      for (let j = 0; j < k; j++) {
        if (counts[j] > 0) {
          centroids[j] = newCentroids[j] / counts[j];
        }
      }
      
      iterations++;
    }
    
    // Construire les clusters
    const clusters: number[][] = new Array(k).fill(null).map(() => []);
    for (let i = 0; i < positions.length; i++) {
      clusters[labels[i]].push(positions[i]);
    }
    
    // Trier les clusters par position X croissante
    const sortedClusters = clusters
      .map((cluster, index) => ({ cluster, centroid: centroids[index], index }))
      .filter(item => item.cluster.length > 0)
      .sort((a, b) => a.centroid - b.centroid);
    
    return {
      clusters: sortedClusters.map(item => item.cluster.sort((a, b) => a - b)),
      centroids: sortedClusters.map(item => item.centroid),
      labels: labels
    };
  }
  
  /**
   * Analyse la densité des positions pour détecter les séparations naturelles
   */
  detectNaturalSeparations(positions: number[], minGap: number = 30): number[] {
    const sortedPositions = [...new Set(positions)].sort((a, b) => a - b);
    const separations: number[] = [];
    
    for (let i = 1; i < sortedPositions.length; i++) {
      const gap = sortedPositions[i] - sortedPositions[i - 1];
      if (gap >= minGap) {
        separations.push((sortedPositions[i] + sortedPositions[i - 1]) / 2);
      }
    }
    
    return separations;
  }
  
  /**
   * Optimise le nombre de clusters basé sur la variance intra-cluster
   */
  findOptimalClusters(positions: number[], maxK: number = 10): number {
    if (positions.length <= 1) return 1;
    
    let bestK = 1;
    let bestScore = Infinity;
    
    for (let k = 1; k <= Math.min(maxK, positions.length); k++) {
      const result = this.kMeans(positions, k);
      const score = this.calculateInertia(positions, result);
      
      if (score < bestScore) {
        bestScore = score;
        bestK = k;
      }
    }
    
    return bestK;
  }
  
  /**
   * Calcule l'inertie (variance intra-cluster)
   */
  private calculateInertia(positions: number[], result: ClusterResult): number {
    let totalInertia = 0;
    
    for (let i = 0; i < result.clusters.length; i++) {
      const cluster = result.clusters[i];
      const centroid = result.centroids[i];
      
      for (const position of cluster) {
        totalInertia += Math.pow(position - centroid, 2);
      }
    }
    
    return totalInertia;
  }
}

export const columnClusteringService = new ColumnClusteringService();
