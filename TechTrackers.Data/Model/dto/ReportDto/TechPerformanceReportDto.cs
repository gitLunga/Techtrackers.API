using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto.ReportDto
{
    public class TechPerformanceReportDto
    {
        public string TechnicianName { get; set; }
        public int AssignedIssues { get; set; }
        public int ResolvedIssues { get; set; }
        public int PendingIssues { get; set; }
        public double AvgResolutionTime { get; set; } // In days
        public double PerformanceRating { get; set; } // Out of 5
    }
}
