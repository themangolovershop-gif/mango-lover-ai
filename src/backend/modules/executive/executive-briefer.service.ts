import { getAIResponse } from "@/lib/ai";
import { ExecutiveBrainService } from "./executive-brain.service";

export class ExecutiveBrieferService {
  private brain = new ExecutiveBrainService();

  async generateDailyReport() {
    const analysis = await this.brain.runGlobalAnalysis();
    
    const prompt = `
      Based on the following business analysis, write a 3-paragraph Executive Brief for the Founder of The Mango Lover Shop.
      
      TONE: Professional, Direct, High-Stakes, Strategic.
      
      DATA:
      ${JSON.stringify(analysis, null, 2)}
      
      STRUCTURE:
      1. Performance Summary (Revenue & Conversion vs Trends)
      2. Top Critical Blockers or Risks identified
      3. Top Strategic Opportunity & Recommended Action for today.
    `;

    const brief = await getAIResponse([
      { role: "user", content: prompt }
    ]);
    
    return {
      date: new Date().toISOString().split('T')[0],
      brief,
      funnel: analysis.funnel,
      stats: analysis.revenueStats
    };
  }
}
