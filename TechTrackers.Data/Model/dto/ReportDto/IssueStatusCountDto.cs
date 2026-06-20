using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto.ReportDto
{
    public class IssueStatusCountDto
    {
        public int Open { get; set; }
        public int InProgress { get; set; }
        public int Completed { get; set; }
        public int Escalated { get; set; }
        public int OnHold { get; set; }
    }
}
